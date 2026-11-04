import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDeterministicScan } from '../src/analyzers/rule-engine.js';
import { summarize, renderScanResult } from '../src/application/commands.js';

describe('deterministic scanner', () => {
  it('finds an empty catch block and ignores a handled catch', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'guardian-'));
    try {
      mkdirSync(join(cwd, 'src'));
      writeFileSync(join(cwd, 'src', 'sample.ts'), 'try { work(); } catch (error) {}\ntry { work(); } catch (error) { throw error; }');
      const findings = runDeterministicScan({ cwd });
      expect(findings.filter((finding) => finding.ruleId === 'EG-001')).toHaveLength(1);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('uses stable fingerprints when lines are inserted before a finding', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'guardian-'));
    try {
      const file = join(cwd, 'sample.ts');
      writeFileSync(file, 'try { work(); } catch (error) {}');
      const first = runDeterministicScan({ cwd })[0]?.id;
      writeFileSync(file, '// moved line\ntry { work(); } catch (error) {}');
      const second = runDeterministicScan({ cwd })[0]?.id;
      expect(second).toBe(first);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('formats JSON with summary and gate data', () => {
    const findings = runDeterministicScan({ cwd: process.cwd(), files: [] });
    const summary = summarize(findings);
    const text = renderScanResult({ findings, summary, blockingFindings: [], passed: true }, 'json');
    expect(JSON.parse(text).gate.passed).toBe(true);
  });
});
