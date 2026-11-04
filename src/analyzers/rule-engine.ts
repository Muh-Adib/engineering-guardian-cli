import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

import { detectProjectProfile } from '../discovery/project-profile.js';
import type { Confidence, Finding, GuardianRule, ProjectProfile, RuleContext, Severity } from './types.js';

const DEFAULT_EXCLUSIONS = ['node_modules', '.next', 'dist', 'build', 'coverage', '.git', '.guardian'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export interface ScanOptions {
  cwd?: string;
  files?: string[];
  include?: string[];
  exclude?: string[];
  project?: ProjectProfile;
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function expandBraces(pattern: string): string[] {
  const startIndex = pattern.indexOf('{');
  if (startIndex < 0) return [pattern];
  const endIndex = pattern.indexOf('}', startIndex + 1);
  if (endIndex < 0) return [pattern];
  const prefix = pattern.slice(0, startIndex);
  const options = pattern.slice(startIndex + 1, endIndex).split(',').map((item) => item.trim()).filter(Boolean);
  const suffix = pattern.slice(endIndex + 1);
  return options.flatMap((option) => expandBraces(prefix + option + suffix));
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let result = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        result += '.*';
        index += 1;
      } else {
        result += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      result += '[^/]';
      continue;
    }
    result += escapeRegExp(char);
  }
  return new RegExp(`^${result}$`);
}

function matchesPattern(file: string, pattern: string): boolean {
  const normalizedFile = file.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  return expandBraces(normalizedPattern).some((candidate) => globToRegExp(candidate).test(normalizedFile));
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
  const before = input.content.slice(0, input.offset);
  const line = before.split(/\r?\n/).length;
  const column = input.offset - before.lastIndexOf('\n');
  return {
    id: `${input.ruleId}-${createHash('sha256').update(`${input.file}:${input.evidence}:${input.occurrence}`).digest('hex').slice(0, 12)}`,
    ruleId: input.ruleId,
    title: input.title,
    description: input.description,
    severity: input.severity,
    confidence: input.confidence,
    category: input.category,
    location: { file: input.file, line, column, endLine: line },
    evidence: input.evidence.trim().slice(0, 240),
    impact: input.impact,
    recommendation: input.recommendation,
    fixMode: input.fixMode
  };
}

function matchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function createRuleEngine(): GuardianRule[] {
  return [
    {
      id: 'EG-001',
      category: 'reliability',
      defaultSeverity: 'P1',
      analyze: ({ filePath, content }) => {
        const findings: Finding[] = [];
        const catchPattern = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
        let match: RegExpExecArray | null;
        while ((match = catchPattern.exec(content)) !== null) {
          const openingBraceIndex = match.index + match[0].lastIndexOf('{');
          const closingBraceIndex = matchingBrace(content, openingBraceIndex);
          if (closingBraceIndex < 0) continue;
          const body = content.slice(openingBraceIndex + 1, closingBraceIndex).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '').trim();
          if (body.length > 0) continue;
          findings.push(makeFinding({
            ruleId: 'EG-001',
            file: filePath,
            content,
            offset: match.index,
            evidence: content.slice(match.index, closingBraceIndex + 1),
            occurrence: findings.length,
            title: 'Empty catch block',
            description: 'The catch block discards the caught error without handling or propagating it.',
            severity: 'P1',
            confidence: 'high',
            category: 'reliability',
            impact: 'Silently swallowed errors can conceal failed operations and leave application state inconsistent.',
            recommendation: 'Handle a known recoverable case, log safely, or rethrow the error.',
            fixMode: 'none'
          }));
        }
        return findings;
      }
    },
    {
      id: 'EG-002',
      category: 'typing',
      defaultSeverity: 'P2',
      analyze: ({ filePath, content }) => {
        const findings: Finding[] = [];
        const assertionPattern = /\bas\s+unknown\s+as\s+[A-Za-z_$][\w$]*(?:\s*<[^;\n]+>)?(?:\[\])?/g;
        let match: RegExpExecArray | null;
        while ((match = assertionPattern.exec(content)) !== null) {
          findings.push(makeFinding({
            ruleId: 'EG-002',
            file: filePath,
            content,
            offset: match.index,
            evidence: match[0],
            occurrence: findings.length,
            title: 'Suspicious double type assertion',
            description: 'Casting through unknown bypasses TypeScript compatibility checks.',
            severity: 'P2',
            confidence: 'medium',
            category: 'typing',
            impact: 'An incorrect assertion can hide a runtime type mismatch.',
            recommendation: 'Use runtime validation, a type guard, or a narrower truthful type.',
            fixMode: 'none'
          }));
        }
        return findings;
      }
    },
    {
      id: 'EG-003',
      category: 'prisma',
      defaultSeverity: 'P2',
      analyze: ({ filePath, content, project }) => {
        if (!project.prismaVersion) return [];
        const findings: Finding[] = [];
        const loopPattern = /\b(?:for|while)\s*\([^)]*\)\s*\{/g;
        let loopMatch: RegExpExecArray | null;
        while ((loopMatch = loopPattern.exec(content)) !== null) {
          const openingBraceIndex = loopMatch.index + loopMatch[0].lastIndexOf('{');
          const closingBraceIndex = matchingBrace(content, openingBraceIndex);
          if (closingBraceIndex < 0) continue;
          const loopBody = content.slice(openingBraceIndex + 1, closingBraceIndex);
          const prismaCallPattern = /\b(?:prisma|db|database)\s*\.\s*\w+\s*\.\s*(?:findMany|findFirst|findUnique|create|createMany|update|updateMany|delete|deleteMany|upsert|count|aggregate)\s*\(/g;
          const callMatch = prismaCallPattern.exec(loopBody);
          if (!callMatch) continue;
          findings.push(makeFinding({
            ruleId: 'EG-003',
            file: filePath,
            content,
            offset: openingBraceIndex + 1 + callMatch.index,
            evidence: callMatch[0],
            occurrence: findings.length,
            title: 'Prisma query inside a loop candidate',
            description: 'A Prisma Client query appears inside a loop and may issue one database round trip per iteration.',
            severity: 'P2',
            confidence: 'medium',
            category: 'performance',
            impact: 'Repeated queries may increase latency and database load; this is a candidate, not proof of an N+1 defect.',
            recommendation: 'Check whether the operation can be batched, expressed as a bulk query, or handled with an existing dataloader.',
            fixMode: 'assisted'
          }));
        }
        return findings;
      }
    }
  ];
}

function isWithinProjectRoot(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !relativePath.startsWith(`${sep}`));
}

function traverse(root: string, current: string, exclusions: string[], results: string[]): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    const relativePath = relative(root, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (DEFAULT_EXCLUSIONS.includes(entry.name) || exclusions.some((pattern) => matchesPattern(relativePath, pattern))) {
        continue;
      }
      traverse(root, fullPath, exclusions, results);
      continue;
    }

    if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      results.push(relativePath);
    }
  }
}

export function listFiles(root: string, exclusions: string[] = DEFAULT_EXCLUSIONS): string[] {
  const resolvedRoot = resolve(root);
  const results: string[] = [];
  traverse(resolvedRoot, resolvedRoot, exclusions, results);
  return results.sort();
}

function resolveRequestedFiles(cwd: string, requestedPaths: string[]): string[] {
  const root = resolve(cwd);
  const resolved = new Set<string>();

  for (const entry of requestedPaths) {
    const absolute = resolve(root, entry);
    if (!isWithinProjectRoot(root, absolute)) {
      throw new Error(`Path is outside the project root: ${entry}`);
    }

    if (!existsSync(absolute)) continue;
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      const base = relative(root, absolute).replace(/\\/g, '/');
      for (const file of listFiles(root)) {
        if (file === base || file.startsWith(`${base}/`)) {
          resolved.add(file);
        }
      }
    } else if (stat.isFile()) {
      resolved.add(relative(root, absolute).replace(/\\/g, '/'));
    }
  }

  return [...resolved].sort();
}

export function runDeterministicScan(options: ScanOptions | string = {}): Finding[] {
  const normalized: ScanOptions = typeof options === 'string' ? { cwd: options } : options;
  const cwd = resolve(normalized.cwd ?? process.cwd());
  const project = normalized.project ?? detectProjectProfile(cwd);
  const excludes = [...DEFAULT_EXCLUSIONS, ...(normalized.exclude ?? [])];
  const files = normalized.files ? resolveRequestedFiles(cwd, normalized.files) : listFiles(cwd, excludes);
  const rules = createRuleEngine();
  const findings: Finding[] = [];

  for (const file of files) {
    const fullPath = resolve(cwd, file);
    if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    if (normalized.include && normalized.include.length > 0 && !normalized.include.some((pattern) => matchesPattern(file, pattern))) continue;
    if (excludes.some((pattern) => matchesPattern(file, pattern))) continue;

    try {
      const content = readFileSync(fullPath, 'utf8');
      const context: RuleContext = { project, filePath: file, content };
      for (const rule of rules) {
        findings.push(...rule.analyze(context));
      }
    } catch {
      // ignore unreadable files
    }
  }

  return findings.sort((a, b) => a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line || a.ruleId.localeCompare(b.ruleId));
}

export function getChangedFiles(cwd = process.cwd(), base?: string): string[] {
  const args = ['diff', '--name-only', '-z'];
  if (base) args.push(`${base}...HEAD`);
  args.push('--');

  const names = new Set<string>();

  for (const output of [
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  ]) {
    for (const item of output.split('\0').filter(Boolean)) {
      const normalized = item.replace(/\\/g, '/');
      if (SOURCE_EXTENSIONS.has(extname(normalized).toLowerCase())) {
        names.add(normalized);
      }
    }
  }

  return [...names].sort();
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
