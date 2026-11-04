import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '../core/config.js';
import { detectProjectProfile, exists } from '../discovery/project-profile.js';
import { getChangedFiles, runDeterministicScan } from '../analyzers/rule-engine.js';
import type { Confidence, Finding, Severity } from '../core/types.js';
import { toSarif } from '../reporters/sarif.js';

export interface RunScanOptions {
  cwd?: string;
  changed?: boolean;
  base?: string;
  paths?: string[];
  format?: 'text' | 'json' | 'sarif';
}

const confidenceRank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function runDoctor(cwd = process.cwd()) {
  const project = detectProjectProfile(cwd);
  const configPath = resolve(cwd, '.guardian/config.json');
  const configExists = existsSync(configPath);
  const lines = [
    'Engineering Guardian doctor',
    `Package manager: ${project.packageManager}`,
    `Node: ${project.nodeVersion ?? 'unknown'}`,
    `TypeScript: ${project.typescriptDetected ? 'detected' : 'missing'}`,
    `Next.js: ${project.nextVersion ?? 'not detected'}`,
    `App Router: ${project.nextAppRouter ? 'detected' : 'not detected'}`,
    `Prisma: ${project.prismaVersion ?? 'not detected'}`,
    `Prisma schema: ${project.prismaSchemaPath ?? 'not found'}`,
    `Database provider: ${project.databaseProvider ?? 'unknown'}`,
    `Git: ${project.gitBranch ?? 'not a Git repository'}${project.gitDirty ? ' (working tree has changes)' : ''}`,
    `Project scripts: ${Object.keys(project.scripts).length ? Object.keys(project.scripts).join(', ') : 'none detected'}`,
    `Guardian config: ${configExists ? 'present' : 'missing (run eg init)'}`
  ];

  return { project, output: lines.join('\n') };
}

export function summarize(findings: Finding[]) {
  const bySeverity: Record<Severity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byRule: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
  }

  return { total: findings.length, bySeverity, byRule, byCategory };
}

export function runScan(options: RunScanOptions | string = {}) {
  const normalized = typeof options === 'string' ? { cwd: options } : options;
  const cwd = normalized.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const paths = normalized.paths ?? (normalized.changed ? getChangedFiles(cwd, normalized.base) : undefined);
  const findings = runDeterministicScan({
    cwd,
    files: paths,
    include: config.scan.include,
    exclude: config.scan.exclude,
    project: detectProjectProfile(cwd)
  });
  const summary = summarize(findings);
  const blockingFindings = findings.filter((finding) => config.gate.failOn.includes(finding.severity) && confidenceRank[finding.confidence] >= confidenceRank[config.gate.minimumConfidence]);
  return { findings, summary, blockingFindings, passed: blockingFindings.length === 0 };
}

export function renderScanResult(result: ReturnType<typeof runScan>, format: RunScanOptions['format'] = 'text'): string {
  if (format === 'json') {
    return JSON.stringify({ findings: result.findings, summary: result.summary, gate: { passed: result.passed, blockingCount: result.blockingFindings.length } }, null, 2);
  }
  if (format === 'sarif') {
    return toSarif(result.findings);
  }

  const lines = [`Engineering Guardian scan: ${result.summary.total} finding(s)`, `Gate: ${result.passed ? 'PASS' : 'FAIL'}`];
  for (const finding of result.findings) {
    lines.push(`${finding.id} [${finding.severity}/${finding.confidence}] ${finding.title} — ${finding.location.file}:${finding.location.line}`);
    lines.push(`  ${finding.recommendation}`);
  }
  if (!result.findings.length) lines.push('No findings.');
  return lines.join('\n');
}

export function initProject(cwd = process.cwd()) {
  const configPath = resolve(cwd, '.guardian/config.json');
  const agentsPath = resolve(cwd, 'AGENTS.md');

  if (!existsSync(resolve(cwd, '.guardian'))) {
    require('node:fs').mkdirSync(resolve(cwd, '.guardian'), { recursive: true });
  }
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${JSON.stringify(loadConfig(cwd), null, 2)}\n`, 'utf8');
  }

  const blockStart = '<!-- ENGINEERING_GUARDIAN:START -->';
  const blockEnd = '<!-- ENGINEERING_GUARDIAN:END -->';
  const block = `${blockStart}\n## Engineering Guardian\n\n- Run \`eg doctor\` to inspect the detected project stack and versions.\n- Run \`eg scan --changed\` before reviewing a change.\n- Treat findings according to \`.guardian/config.json\`; contextual findings are not proof of a defect.\n- Keep repair preview-first and require explicit human approval before any write.\n- Do not claim verification succeeded unless the corresponding checks were actually run.\n${blockEnd}`;

  if (existsSync(agentsPath)) {
    const content = readFileSync(agentsPath, 'utf8');
    const startIndex = content.indexOf(blockStart);
    const endIndex = content.indexOf(blockEnd);
    if (startIndex >= 0 && endIndex >= startIndex) {
      const next = `${content.slice(0, startIndex)}${block}${content.slice(endIndex + blockEnd.length)}`;
      writeFileSync(agentsPath, next, 'utf8');
    } else {
      const next = `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${block}\n`;
      writeFileSync(agentsPath, next, 'utf8');
    }
  } else {
    writeFileSync(agentsPath, `${block}\n`, 'utf8');
  }

  return { configPath, agentsPath };
}

export function verifyProject(cwd = process.cwd()) {
  const project = detectProjectProfile(cwd);
  const commands = Object.entries(project.scripts).map(([name, script]) => ({ name, script }));
  return {
    project,
    commands,
    status: commands.length ? 'quality scripts detected; execution is explicitly opt-in' : 'no recognized quality scripts detected',
    message: 'Guardian reports discovered scripts only; no command is executed by verify.'
  };
}
