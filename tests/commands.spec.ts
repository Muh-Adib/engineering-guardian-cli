import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initProject, runDoctor, runScan, verifyProject } from '../src/application/commands.js';

describe('Engineering Guardian commands', () => {
  it('initializes config and agent instructions in a target directory', () => {
    const target = join(process.cwd(), '.guardian-test-tmp');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'test-app' }), 'utf8');

    const result = initProject(target);

    expect(result.configPath).toContain('.guardian/config.json');
    expect(result.agentsPath).toContain('AGENTS.md');
  });

  it('detects basic project metadata', () => {
    const result = runDoctor(process.cwd());
    expect(result.output).toContain('Engineering Guardian doctor');
    expect(result.project).toBeDefined();
  });

  it('returns scan summary object', () => {
    const result = runScan(process.cwd());
    expect(result.summary.total).toBeGreaterThanOrEqual(0);
    expect(result.summary.bySeverity).toBeDefined();
  });

  it('returns verification status', () => {
    const result = verifyProject(process.cwd());
    expect(result.status).toMatch(/detected|scripts/i);
  });
});
