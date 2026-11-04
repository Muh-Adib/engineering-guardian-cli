import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDeterministicScan } from '../src/analyzers/rule-engine.js';
import { summarize, renderScanResult } from '../src/application/commands.js';

function withTempProject(files: Record<string, string>, fn: (cwd: string) => void): void {
  const cwd = mkdtempSync(join(tmpdir(), 'guardian-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = join(cwd, name);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('deterministic scanner', () => {
  it('finds an empty catch block and ignores a handled catch', () => {
    withTempProject({ 'src/sample.ts': 'try { work(); } catch (error) {}\ntry { work(); } catch (error) { throw error; }' }, (cwd) => {
      const findings = runDeterministicScan({ cwd });
      expect(findings.filter((finding) => finding.ruleId === 'EG-001')).toHaveLength(1);
    });
  });

  it('uses stable fingerprints when lines are inserted before a finding', () => {
    withTempProject({ 'sample.ts': 'try { work(); } catch (error) {}' }, (cwd) => {
      const first = runDeterministicScan({ cwd })[0]?.id;
      writeFileSync(join(cwd, 'sample.ts'), '// moved line\ntry { work(); } catch (error) {}');
      const second = runDeterministicScan({ cwd })[0]?.id;
      expect(second).toBe(first);
    });
  });

  it('keeps stable ids when an unrelated finding is removed', () => {
    withTempProject(
      { 'a.ts': 'try { x(); } catch (e) {}\nconst v = data as unknown as Foo;\ntry { y(); } catch (e) {}\n' },
      (cwd) => {
        const file = join(cwd, 'a.ts');
        const before = runDeterministicScan({ cwd }).map((f) => f.id);
        // Remove the EG-002 finding only; both EG-001 ids must survive.
        writeFileSync(file, 'try { x(); } catch (e) {}\ntry { y(); } catch (e) {}\n');
        const after = runDeterministicScan({ cwd }).map((f) => f.id);
        expect(after).toEqual(expect.arrayContaining(before.filter((id) => id.startsWith('EG-001'))));
      }
    );
  });

  it('does not flag catch patterns inside strings or comments', () => {
    withTempProject(
      { 'b.ts': 'const msg = "catch (err) {}"; // catch (e) {}\n/* catch (e) {} */\nconst s = `as unknown as Foo`;\n' },
      (cwd) => {
        expect(runDeterministicScan({ cwd })).toHaveLength(0);
      }
    );
  });

  it('scans directories passed via files and warns for missing paths', () => {
    withTempProject({ 'src/api/route.ts': 'try { a(); } catch (e) {}\n' }, (cwd) => {
      const warnings: string[] = [];
      const findings = runDeterministicScan({ cwd, files: ['src'], warnings });
      expect(findings.filter((f) => f.ruleId === 'EG-001')).toHaveLength(1);
      expect(warnings).toHaveLength(0);

      const missing = runDeterministicScan({ cwd, files: ['src', 'does-not-exist'], warnings });
      expect(missing.filter((f) => f.ruleId === 'EG-001')).toHaveLength(1);
      expect(warnings.some((w) => w.includes('does-not-exist'))).toBe(true);
    });
  });

  it('supports brace expansion in include patterns', () => {
    withTempProject({ 'src/sample.ts': 'try { a(); } catch (e) {}\n' }, (cwd) => {
      const warnings: string[] = [];
      const findings = runDeterministicScan({ cwd, include: ['src/**/*.{ts,tsx,js,jsx}'], warnings });
      expect(findings.filter((f) => f.ruleId === 'EG-001')).toHaveLength(1);
      expect(warnings).toHaveLength(0);
    });
  });

  it('warns when include/exclude patterns filter out every provided path', () => {
    withTempProject({ 'src/skipme/x.ts': 'try { a(); } catch (e) {}\n' }, (cwd) => {
      const warnings: string[] = [];
      runDeterministicScan({ cwd, files: ['src/skipme/x.ts'], include: ['nomatch/**'], warnings });
      expect(warnings.some((w) => w.includes('zero files'))).toBe(true);
    });
  });

  it('flags a prisma query inside a loop with nested parentheses', () => {
    withTempProject(
      {
        'package.json': JSON.stringify({ dependencies: { '@prisma/client': '6.0.0' } }),
        'src/s.ts': 'const items = [1,2];\nfor (const id of items.filter((i) => i > 0)) { prisma.user.findMany({ where: { id } }); }\n'
      },
      (cwd) => {
        const findings = runDeterministicScan({ cwd });
        expect(findings.filter((f) => f.ruleId === 'EG-003')).toHaveLength(1);
      }
    );
  });

  it('reports real endLine for findings', () => {
    withTempProject({ 'c.ts': 'try { work(); } catch (error) {\n\n}' }, (cwd) => {
      const finding = runDeterministicScan({ cwd })[0];
      expect(finding?.location.line).toBe(1);
      expect(finding?.location.endLine).toBe(3);
    });
  });

  it('formats JSON with summary and gate data', () => {
    withTempProject({ 'src/sample.ts': 'try { work(); } catch (error) {}\n' }, (cwd) => {
      const findings = runDeterministicScan({ cwd, files: [] });
      const summary = summarize(findings);
      const text = renderScanResult({ findings, summary, blockingFindings: [], passed: true, warnings: [] }, 'json');
      expect(JSON.parse(text).gate.passed).toBe(true);
    });
  });
});
