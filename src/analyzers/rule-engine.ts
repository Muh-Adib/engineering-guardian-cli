import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

import { detectProjectProfile } from '../discovery/project-profile.js';
import { maskLiteralsAndComments } from '../core/mask.js';
import type { Confidence, Finding, GuardianRule, ProjectProfile, RuleContext, Severity } from '../core/types.js';

const DEFAULT_EXCLUSIONS = ['node_modules', '.next', 'dist', 'build', 'coverage', '.git', '.guardian'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export interface ScanOptions {
  cwd?: string;
  files?: string[];
  include?: string[];
  exclude?: string[];
  project?: ProjectProfile;
  /** Receives non-fatal scan warnings (missing paths, fully filtered input). */
  warnings?: string[];
}

function findingId(ruleId: string, file: string, evidence: string, duplicateIndex: number): string {
  const fingerprint = createHash('sha256')
    .update(`${ruleId}\0${file}\0${evidence.replace(/\s+/g, ' ').trim()}\0${duplicateIndex}`)
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

function matchingParen(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')' && --depth === 0) return index;
  }
  return -1;
}

/** Counts how many prior findings in this file share the exact same evidence, so
 *  only true duplicates disambiguate the fingerprint. Removing an unrelated
 *  finding therefore never shifts another finding's stable ID. */
function duplicateIndexOf(seen: Map<string, number>, evidence: string): number {
  const next = seen.get(evidence) ?? 0;
  seen.set(evidence, next + 1);
  return next;
}

function makeFinding(input: {
  ruleId: string;
  file: string;
  content: string;
  offset: number;
  endOffset: number;
  evidence: string;
  duplicateIndex: number;
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
  const endLocation = locationAt(input.file, input.content, Math.max(input.endOffset - 1, input.offset));
  return {
    id: findingId(input.ruleId, input.file, input.evidence, input.duplicateIndex),
    ruleId: input.ruleId,
    title: input.title,
    description: input.description,
    severity: input.severity,
    confidence: input.confidence,
    category: input.category,
    location: { ...location, endLine: endLocation.line, endColumn: (endLocation.column ?? 1) + (input.endOffset - 1 - input.offset) },
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
      const masked = maskLiteralsAndComments(content);
      const findings: Finding[] = [];
      const seen = new Map<string, number>();
      const catchKeyword = /\bcatch\b/g;
      let match: RegExpExecArray | null;
      while ((match = catchKeyword.exec(masked)) !== null) {
        let cursor = match.index + match[0].length;
        while (cursor < masked.length && /\s/.test(masked[cursor])) cursor += 1;
        if (masked[cursor] === '(') {
          const parenClose = matchingParen(masked, cursor);
          if (parenClose < 0) continue;
          cursor = parenClose + 1;
          while (cursor < masked.length && /\s/.test(masked[cursor])) cursor += 1;
        }
        if (masked[cursor] !== '{') continue;
        const close = matchingBrace(masked, cursor);
        if (close < 0) continue;
        // Masked bodies contain no comments or string literals, so a body of
        // only whitespace is a genuinely empty block.
        if (masked.slice(cursor + 1, close).trim().length > 0) continue;
        const evidence = content.slice(match.index, close + 1);
        findings.push(makeFinding({
          ruleId: 'EG-001', file: filePath, content, offset: match.index, endOffset: close + 1,
          evidence, duplicateIndex: duplicateIndexOf(seen, evidence),
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
      const masked = maskLiteralsAndComments(content);
      const findings: Finding[] = [];
      const seen = new Map<string, number>();
      const expression = /\bas\s+unknown\s+as\s+[A-Za-z_$][\w$]*(?:\s*<[^;\n]+>)?(?:\[\])?/g;
      let match: RegExpExecArray | null;
      while ((match = expression.exec(masked)) !== null) {
        const evidence = content.slice(match.index, match.index + match[0].length);
        findings.push(makeFinding({
          ruleId: 'EG-002', file: filePath, content, offset: match.index, endOffset: match.index + match[0].length,
          evidence, duplicateIndex: duplicateIndexOf(seen, evidence),
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
    id: 'EG-003', category: 'performance', defaultSeverity: 'P2',
    analyze: ({ filePath, content, project }) => {
      if (!project.prismaVersion) return [];
      const masked = maskLiteralsAndComments(content);
      const findings: Finding[] = [];
      const seen = new Map<string, number>();
      const loopKeyword = /\bfor(?:\s+await)?\b|\bwhile\b/g;
      const query = /\b(?:prisma|db|database)\s*\.\s*\w+\s*\.\s*(?:findMany|findFirst|findUnique|create|createMany|update|updateMany|delete|deleteMany|upsert|count|aggregate)\s*\(/g;
      let loop: RegExpExecArray | null;
      while ((loop = loopKeyword.exec(masked)) !== null) {
        if (loop[0].startsWith('while')) {
          // Skip do..while: its body precedes the keyword.
          let before = loop.index - 1;
          while (before >= 0 && /\s/.test(masked[before])) before -= 1;
          if (before >= 0 && masked[before] === '}') continue;
        }
        let cursor = loop.index + loop[0].length;
        while (cursor < masked.length && /\s/.test(masked[cursor])) cursor += 1;
        if (masked[cursor] !== '(') continue;
        const parenClose = matchingParen(masked, cursor);
        if (parenClose < 0) continue;
        let bodyStart = parenClose + 1;
        while (bodyStart < masked.length && /\s/.test(masked[bodyStart])) bodyStart += 1;
        let bodyEnd: number;
        if (masked[bodyStart] === '{') {
          const close = matchingBrace(masked, bodyStart);
          if (close < 0) continue;
          bodyStart += 1;
          bodyEnd = close;
        } else {
          // Single-statement loop body: everything up to the next semicolon.
          const semi = masked.indexOf(';', bodyStart);
          if (semi < 0) continue;
          bodyEnd = semi;
        }
        const body = masked.slice(bodyStart, bodyEnd);
        const call = query.exec(body);
        if (!call) continue;
        const offset = bodyStart + call.index;
        const evidence = content.slice(offset, offset + call[0].length);
        findings.push(makeFinding({
          ruleId: 'EG-003', file: filePath, content, offset, endOffset: offset + call[0].length,
          evidence, duplicateIndex: duplicateIndexOf(seen, evidence),
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

/** Expands glob brace alternates ({ts,tsx}) so include/exclude patterns behave
 *  the way the config file documents them. */
function expandBraces(pattern: string): string[] {
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match) return [pattern];
  const [full, inner] = match;
  return inner.split(',').flatMap((option) => expandBraces(pattern.replace(full, option)));
}

function globToRegExp(pattern: string): RegExp {
  const body = expandBraces(pattern.replace(/\\/g, '/'))
    .map((alternative) => alternative
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      // Glob ? must become [^/] BEFORE the ** placeholders insert their own
      // ? quantifiers, otherwise (?:.*/)? gets corrupted.
      .replace(/\?/g, '[^/]')
      .replace(/\*\*/g, '§§')
      .replace(/\*/g, '[^/]*')
      .replace(/§§\//g, '(?:.*/)?')
      .replace(/§§/g, '.*'))
    .join('|');
  return new RegExp(`^${body}$`);
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

/** Resolves user-provided scan targets: files pass through, directories are
 *  expanded recursively (honoring exclusions), and every rejected input is
 *  reported as a warning instead of being silently dropped. */
function resolveInputFiles(inputs: string[], cwd: string, exclusions: string[], warnings: string[]): string[] {
  const resolved = new Set<string>();
  for (const input of inputs) {
    const abs = resolve(cwd, input);
    const stats = statSync(abs, { throwIfNoEntry: false });
    if (!stats) {
      warnings.push(`Path not found, ignored: ${input}`);
      continue;
    }
    if (!abs.startsWith(`${cwd}${sep}`)) {
      warnings.push(`Path outside the project directory, ignored: ${input}`);
      continue;
    }
    if (stats.isFile()) {
      resolved.add(relative(cwd, abs).split(sep).join('/'));
    } else if (stats.isDirectory()) {
      const relDir = relative(cwd, abs).split(sep).join('/');
      for (const rel of listFiles(abs, exclusions)) {
        resolved.add(relDir ? `${relDir}/${rel}` : rel);
      }
    } else {
      warnings.push(`Not a scannable file or directory, ignored: ${input}`);
    }
  }
  return [...resolved].filter((file) => SOURCE_EXTENSIONS.has(extname(file).toLowerCase())).sort();
}

export function runDeterministicScan(options: ScanOptions | string = {}): Finding[] {
  const normalized: ScanOptions = typeof options === 'string' ? { cwd: options } : options;
  const cwd = resolve(normalized.cwd ?? process.cwd());
  const project = normalized.project ?? detectProjectProfile(cwd);
  const warnings = normalized.warnings ?? [];
  const exclusions = [...DEFAULT_EXCLUSIONS, ...(normalized.exclude ?? [])];
  const files = normalized.files?.length
    ? resolveInputFiles(normalized.files, cwd, exclusions, warnings)
    : listFiles(cwd, exclusions);
  const rules = createRuleEngine();
  const findings: Finding[] = [];
  let scanned = 0;

  for (const file of files) {
    if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    if (matchesAny(file, exclusions) || (normalized.include?.length && !matchesAny(file, normalized.include))) continue;
    let content: string;
    try { content = readFileSync(resolve(cwd, file), 'utf8'); } catch { continue; }
    scanned += 1;
    const context: RuleContext = { project, filePath: file, content };
    for (const rule of rules) findings.push(...rule.analyze(context));
  }

  if (files.length > 0 && scanned === 0) {
    warnings.push('All candidate files were filtered out by include/exclude patterns; the gate was evaluated on zero files.');
  }
  return findings.sort((a, b) => a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line || a.ruleId.localeCompare(b.ruleId));
}
