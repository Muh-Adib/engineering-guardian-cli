import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

import { detectProjectProfile } from '../discovery/project-profile.js';
import type { Confidence, Finding, GuardianRule, ProjectProfile, RuleContext, Severity } from '../core/types.js';

const DEFAULT_EXCLUSIONS = ['node_modules', '.next', 'dist', 'build', 'coverage', '.git', '.guardian'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export interface ScanOptions {
  cwd?: string;
  files?: string[];
  include?: string[];
  exclude?: string[];
  project?: ProjectProfile;
}

function findingId(ruleId: string, file: string, evidence: string, occurrence: number): string {
  const fingerprint = createHash('sha256')
    .update(`${ruleId}\0${file}\0${evidence.replace(/\s+/g, ' ').trim()}\0${occurrence}`)
    .digest('hex')
    .slice(0, 16);
  return `${ruleId}-${fingerprint}`;
}

function locationAt(file: string, content: string, offset: number) {
  const before = content.slice(0, offset);
  const line = before.split(/\r?\n/).length;
  const lastNewline = before.lastIndexOf('\n');
  return { file, line, column: offset - lastNewline };
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

function makeFinding(input: {
  ruleId: string;
  file: string;
  content: string;
  offset: number;
  evidence: string;
  occurrence: number;
  title: string;
  description: string;
  severity: Severity;
  confidence: Confidence;
  category: string;
  impact: string;
  recommendation: string;
  fixMode: Finding['fixMode'];
}): Finding {
  const location = locationAt(input.file, input.content, input.offset);
  return {
    id: findingId(input.ruleId, input.file, input.evidence, input.occurrence),
    ruleId: input.ruleId,
    title: input.title,
    description: input.description,
    severity: input.severity,
    confidence: input.confidence,
    category: input.category,
    location: { ...location, endLine: location.line },
    evidence: input.evidence.trim().slice(0, 240),
    impact: input.impact,
    recommendation: input.recommendation,
    fixMode: input.fixMode
  };
}

export function createRuleEngine(): GuardianRule[] {
  const silentCatch: GuardianRule = {
    id: 'EG-001', category: 'reliability', defaultSeverity: 'P1',
    analyze: ({ filePath, content }) => {
      const findings: Finding[] = [];
      const expression = /\bcatch\s*(?:\([^)]*\)\s*)?\{/g;
      let match: RegExpExecArray | null;
      while ((match = expression.exec(content)) !== null) {
        const open = match.index + match[0].lastIndexOf('{');
        const close = matchingBrace(content, open);
        if (close < 0) continue;
        const body = content.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '').trim();
        if (body.length > 0) continue;
        findings.push(makeFinding({
          ruleId: 'EG-001', file: filePath, content, offset: match.index,
          evidence: content.slice(match.index, close + 1), occurrence: findings.length,
          title: 'Empty catch block',
          description: 'The catch block discards the caught error without handling or propagating it.',
          severity: 'P1', confidence: 'high', category: 'reliability',
          impact: 'Silently swallowed errors can conceal failed operations and leave application state inconsistent.',
          recommendation: 'Handle a known recoverable case, log safely, or rethrow the error.', fixMode: 'none'
        }));
      }
      return findings;
    }
  };

  const doubleAssertion: GuardianRule = {
    id: 'EG-002', category: 'typing', defaultSeverity: 'P2',
    analyze: ({ filePath, content }) => {
      const findings: Finding[] = [];
      const expression = /\bas\s+unknown\s+as\s+[A-Za-z_$][\w$]*(?:\s*<[^;\n]+>)?(?:\[\])?/g;
      let match: RegExpExecArray | null;
      while ((match = expression.exec(content)) !== null) {
        findings.push(makeFinding({
          ruleId: 'EG-002', file: filePath, content, offset: match.index,
          evidence: match[0], occurrence: findings.length,
          title: 'Suspicious double type assertion',
          description: 'Casting through unknown bypasses TypeScript compatibility checks.',
          severity: 'P2', confidence: 'medium', category: 'typing',
          impact: 'An incorrect assertion can hide a runtime type mismatch.',
          recommendation: 'Use runtime validation, a type guard, or a narrower truthful type.', fixMode: 'none'
        }));
      }
      return findings;
    }
  };

  const prismaQueryInLoop: GuardianRule = {
    id: 'EG-003', category: 'prisma', defaultSeverity: 'P2',
    analyze: ({ filePath, content, project }) => {
      if (!project.prismaVersion) return [];
      const findings: Finding[] = [];
      const loops = /\b(?:for|while)\s*(?:\([^)]*\)|\([^)]*\)\s*)\s*\{/g;
      let loop: RegExpExecArray | null;
      while ((loop = loops.exec(content)) !== null) {
        const open = loop.index + loop[0].lastIndexOf('{');
        const close = matchingBrace(content, open);
        if (close < 0) continue;
        const body = content.slice(open + 1, close);
        const query = /\b(?:prisma|db|database)\s*\.\s*\w+\s*\.\s*(?:findMany|findFirst|findUnique|create|createMany|update|updateMany|delete|deleteMany|upsert|count|aggregate)\s*\(/g;
        const call = query.exec(body);
        if (!call) continue;
        const offset = open + 1 + call.index;
        findings.push(makeFinding({
          ruleId: 'EG-003', file: filePath, content, offset,
          evidence: call[0], occurrence: findings.length,
          title: 'Prisma query inside a loop candidate',
          description: 'A Prisma Client query appears inside a loop and may issue one database round trip per iteration.',
          severity: 'P2', confidence: 'medium', category: 'performance',
          impact: 'Repeated queries may increase latency and database load; this is a candidate, not proof of an N+1 defect.',
          recommendation: 'Check whether the operation can be batched, expressed as a bulk query, or handled with an existing dataloader.',
          fixMode: 'assisted'
        }));
      }
      return findings;
    }
  };

  return [silentCatch, doubleAssertion, prismaQueryInLoop];
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§\//g, '(?:.*/)?')
    .replace(/§§/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function matchesAny(file: string, patterns: string[] = []): boolean {
  return patterns.some((pattern) => globToRegExp(pattern.replace(/\\/g, '/')).test(file));
}

export function listFiles(root: string, exclusions: string[] = DEFAULT_EXCLUSIONS): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');
      if (entry.isDirectory()) {
        if (exclusions.includes(entry.name) || exclusions.some((pattern) => matchesAny(rel, [pattern]))) continue;
        walk(full);
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        results.push(rel);
      }
    }
  }
  walk(root);
  return results.sort();
}

export function runDeterministicScan(options: ScanOptions | string = {}): Finding[] {
  const normalized: ScanOptions = typeof options === 'string' ? { cwd: options } : options;
  const cwd = resolve(normalized.cwd ?? process.cwd());
  const project = normalized.project ?? detectProjectProfile(cwd);
  const exclusions = [...DEFAULT_EXCLUSIONS, ...(normalized.exclude ?? [])];
  const files = normalized.files
    ? normalized.files.map((file) => resolve(cwd, file)).filter((file) => file.startsWith(`${cwd}${sep}`) && statSync(file, { throwIfNoEntry: false })?.isFile()).map((file) => relative(cwd, file).split(sep).join('/'))
    : listFiles(cwd, exclusions);
  const rules = createRuleEngine();
  const findings: Finding[] = [];

  for (const file of files) {
    if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    if (matchesAny(file, exclusions) || (normalized.include?.length && !matchesAny(file, normalized.include))) continue;
    let content: string;
    try { content = readFileSync(resolve(cwd, file), 'utf8'); } catch { continue; }
    const context: RuleContext = { project, filePath: file, content };
    for (const rule of rules) findings.push(...rule.analyze(context));
  }
  return findings.sort((a, b) => a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line || a.ruleId.localeCompare(b.ruleId));
}

export function getChangedFiles(cwd = process.cwd(), base?: string): string[] {
  const args = ['diff', '--name-only', '-z'];
  if (base) args.push(`${base}...HEAD`);
  args.push('--');
  const output = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return [...new Set(output.split('\0').filter(Boolean).map((file) => file.replace(/\\/g, '/')))]
    .filter((file) => SOURCE_EXTENSIONS.has(extname(file).toLowerCase()));
}

export function getGitStatus(cwd = process.cwd()): { branch: string | null; dirty: boolean } {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { branch: branch || null, dirty: status.length > 0 };
  } catch {
    return { branch: null, dirty: false };
  }
}

export function ruleIdForSeverity(finding: Finding): Severity {
  return finding.severity;
}

export function getFileName(file: string): string {
  return basename(file);
}
