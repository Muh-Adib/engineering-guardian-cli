import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { detectProjectProfile } from '../discovery/project-profile.js';
import { runDeterministicScan } from '../analyzers/rule-engine.js';
import { scaffoldGuardianConfig } from '../core/config.js';

export function runDoctor(cwd = process.cwd()) {
  const project = detectProjectProfile(cwd);
  const lines = [
    'Engineering Guardian doctor',
    `Package manager: ${project.packageManager}`,
    `Node: ${project.nodeVersion ?? 'unknown'}`,
    `TypeScript: ${project.typescriptDetected ? 'detected' : 'missing'}`,
    `Next.js: ${project.nextVersion ?? 'not detected'}`,
    `App Router: ${project.nextAppRouter ? 'enabled' : 'not detected'}`,
    `Prisma: ${project.prismaVersion ?? 'not detected'}`,
    `Prisma schema: ${project.prismaSchemaPath ?? 'not found'}`,
    `Database provider: ${project.databaseProvider ?? 'unknown'}`,
    `Project scripts: ${Object.keys(project.scripts).length ? Object.keys(project.scripts).join(', ') : 'none detected'}`
  ];

  return {
    project,
    output: lines.join('\n')
  };
}

export function runScan(cwd = process.cwd()) {
  const findings = runDeterministicScan(cwd);
  const summary = {
    total: findings.length,
    bySeverity: {
      P0: findings.filter((item) => item.severity === 'P0').length,
      P1: findings.filter((item) => item.severity === 'P1').length,
      P2: findings.filter((item) => item.severity === 'P2').length,
      P3: findings.filter((item) => item.severity === 'P3').length
    },
    byRule: Object.fromEntries([...new Set(findings.map((item) => item.ruleId))].map((rule) => [rule, findings.filter((item) => item.ruleId === rule).length]))
  };

  return {
    findings,
    summary
  };
}

export function initProject(cwd = process.cwd()) {
  const configPath = scaffoldGuardianConfig(cwd);
  const agentsPath = resolve(cwd, 'AGENTS.md');

  if (!existsSync(agentsPath)) {
    const initial = `# Project guidance\n\nThis repository is configured for Engineering Guardian.\n\n<!-- ENGINEERING_GUARDIAN:START -->\n## Engineering Guardian\n- Run \'eg doctor\' before making assumptions about the stack.\n- Run \'eg scan --changed\' before commit review.\n- AI repair is preview-only and requires explicit approval.\n<!-- ENGINEERING_GUARDIAN:END -->\n`;
    writeFileSync(agentsPath, initial, 'utf8');
  }

  return {
    configPath,
    agentsPath
  };
}

export function verifyProject(cwd = process.cwd()) {
  const project = detectProjectProfile(cwd);
  const commands = Object.keys(project.scripts).map((name) => `${name}: ${project.scripts[name]}`);
  return {
    project,
    commands,
    status: commands.length ? 'quality scripts detected' : 'no project scripts detected',
    message: 'Verification is scaffolded; real project scripts should be invoked by the repository's own tooling.'
  };
}
