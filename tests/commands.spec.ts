import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initProject, runDoctor, runScan, verifyProject } from '../src/application/commands.js';

describe('Engineering Guardian commands', () => {
  it('initializes config and agent instructions in a target directory', () => {
    const target = mkdtempSync(join(tmpdir(), 'guardian-init-'));
    try {
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'test-app' }), 'utf8');

      const result = initProject(target);

      expect(result.configPath).toContain('.guardian/config.json');
      expect(result.configCreated).toBe(true);
      expect(result.agentsPath).toContain('AGENTS.md');
      expect(readFileSync(result.agentsPath, 'utf8')).toContain('ENGINEERING_GUARDIAN:START');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('never clobbers a customized config and is idempotent', () => {
    const target = mkdtempSync(join(tmpdir(), 'guardian-init2-'));
    try {
      initProject(target);
      const configPath = join(target, '.guardian/config.json');
      writeFileSync(configPath, JSON.stringify({ gate: { failOn: ['P0', 'P1', 'P2'] } }), 'utf8');

      const second = initProject(target);

      expect(second.configCreated).toBe(false);
      expect(JSON.parse(readFileSync(configPath, 'utf8')).gate.failOn).toEqual(['P0', 'P1', 'P2']);

      // Re-running init must not duplicate the managed block.
      initProject(target);
      const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8');
      expect(agents.match(/ENGINEERING_GUARDIAN:START/g)).toHaveLength(1);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('heals an AGENTS.md with an orphan START marker', () => {
    const target = mkdtempSync(join(tmpdir(), 'guardian-init3-'));
    try {
      writeFileSync(join(target, 'AGENTS.md'), 'My notes\n\n<!-- ENGINEERING_GUARDIAN:START -->\n- stale rule without end marker\n', 'utf8');

      initProject(target);

      const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8');
      expect(agents.startsWith('My notes')).toBe(true);
      expect(agents.match(/ENGINEERING_GUARDIAN:START/g)).toHaveLength(1);
      expect(agents.match(/ENGINEERING_GUARDIAN:END/g)).toHaveLength(1);
      expect(agents).not.toContain('stale rule');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('detects basic project metadata without depending on the host repo', () => {
    const target = mkdtempSync(join(tmpdir(), 'guardian-doctor-'));
    try {
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { test: 'vitest' } }), 'utf8');
      const result = runDoctor(target);
      expect(result.output).toContain('Engineering Guardian doctor');
      expect(result.output).toContain('Package manager: unknown');
      expect(result.output).toContain('not a Git repository');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('fails the gate on a high-confidence P1 finding', () => {
    const target = mkdtempSync(join(tmpdir(), 'guardian-gate-'));
    try {
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'test-app' }), 'utf8');
      mkdirSync(join(target, 'src'), { recursive: true });
      writeFileSync(join(target, 'src', 'sample.ts'), 'try { work(); } catch (error) {}\n', 'utf8');

      const result = runScan({ cwd: target });

      expect(result.findings.filter((f) => f.ruleId === 'EG-001')).toHaveLength(1);
      expect(result.blockingFindings).toHaveLength(1);
      expect(result.passed).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('returns verification status', () => {
    const target = mkdtempSync(join(tmpdir(), 'guardian-verify-'));
    try {
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'test-app', scripts: { test: 'vitest run' } }), 'utf8');
      const result = verifyProject(target);
      expect(result.status).toMatch(/detected|scripts/i);
      expect(result.commands).toEqual([{ name: 'test', script: 'vitest run' }]);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('does not leave temporary directories inside the repository', () => {
    // Regression guard for the old `.guardian-test-tmp` pollution.
    expect(existsSync(join(process.cwd(), '.guardian-test-tmp'))).toBe(false);
  });
});
