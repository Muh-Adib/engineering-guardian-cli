import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import type { Finding, RuleContext, GuardianRule } from '../core/types.js';

const fileExclusions = ['node_modules', '.next', 'dist', 'coverage', '.git', '.guardian'];

export function createRuleEngine(): GuardianRule[] {
  return [
    {
      id: 'EG-001',
      category: 'reliability',
      defaultSeverity: 'P1',
      analyze: ({ filePath, content }) => {
        const findings: Finding[] = [];
        const lines = content.split(/\r?\n/);

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (/catch\s*\(/.test(line)) {
            const nextLine = lines[index + 1] ?? '';
            if (!nextLine.trim() || /^\s*\{\s*$/.test(nextLine.trim())) {
              findings.push({
                id: `${filePath}:${index + 1}:EG-001`,
                ruleId: 'EG-001',
                title: 'Empty or silent catch block',
                description: 'A catch block appears to be empty or contains no meaningful fallback or rethrow.',
                severity: 'P1',
                confidence: 'high',
                category: 'reliability',
                location: {
                  file: filePath,
                  line: index + 1,
                  column: 1,
                  endLine: index + 1
                },
                evidence: line,
                impact: 'Errors may be swallowed silently, masking production defects.',
                recommendation: 'Log the error, rethrow intentionally, or provide a deliberate fallback path.',
                fixMode: 'safe'
              });
            }
          }
        }

        return findings;
      }
    },
    {
      id: 'EG-002',
      category: 'typing',
      defaultSeverity: 'P2',
      analyze: ({ filePath, content }) => {
        const matches = [...content.matchAll(/as\s+unknown\s+as\s+[A-Za-z_][\w<>\[\]]*/g)];
        return matches.map((match, index) => ({
          id: `${filePath}:${match.index ?? 0}:EG-002-${index}`,
          ruleId: 'EG-002',
          title: 'Suspicious double assertion',
          description: 'The code uses a double assertion pattern that can hide incorrect types and reduce safety.',
          severity: 'P2',
          confidence: 'medium',
          category: 'typing',
          location: {
            file: filePath,
            line: content.slice(0, match.index ?? 0).split(/\r?\n/).length,
            column: (match.index ?? 0) - content.lastIndexOf('\n', match.index ?? 0),
            endLine: content.slice(0, match.index ?? 0).split(/\r?\n/).length
          },
          evidence: match[0],
          impact: 'Type safety is weakened and real runtime errors may be hidden by incorrect casts.',
          recommendation: 'Prefer a verified type guard or a precise target type instead of double assertions.',
          fixMode: 'safe'
        }));
      }
    },
    {
      id: 'EG-003',
      category: 'prisma',
      defaultSeverity: 'P2',
      analyze: ({ filePath, content, project }) => {
        if (!project.prismaVersion) return [];

        const findings: Finding[] = [];
        const matches = [...content.matchAll(/for\s*\([^)]*\)\s*\{[\s\S]*?await\s+.*(findMany|findFirst|findUnique|create|update|delete|upsert)\s*\(/g)];

        for (const match of matches) {
          findings.push({
            id: `${filePath}:${match.index ?? 0}:EG-003`,
            ruleId: 'EG-003',
            title: 'Prisma query in loop candidate',
            description: 'A Prisma database call appears inside a loop and may produce an N+1 query pattern.',
            severity: 'P2',
            confidence: 'medium',
            category: 'prisma',
            location: {
              file: filePath,
              line: content.slice(0, match.index ?? 0).split(/\r?\n/).length,
              column: 1,
              endLine: content.slice(0, match.index ?? 0).split(/\r?\n/).length
            },
            evidence: match[0].slice(0, 180),
            impact: 'Repeated queries can degrade performance and increase database load under production traffic.',
            recommendation: 'Batch the operation, use include/select, or replace the loop with a single bulk query when appropriate.',
            fixMode: 'assisted'
          });
        }

        return findings;
      }
    }
  ];
}

export function runDeterministicScan(cwd = process.cwd(), exclusions: string[] = fileExclusions): Finding[] {
  const root = resolve(cwd);
  const files = listFiles(root, exclusions);
  const findings: Finding[] = [];
  const rules = createRuleEngine();

  for (const file of files) {
    const absolute = resolve(root, file);
    const content = readFileSync(absolute, 'utf8');
    const context = {
      project: {
        packageManager: 'npm',
        nodeVersion: process.version,
        typescriptDetected: true,
        nextVersion: '16.x',
        nextAppRouter: true,
        prismaVersion: '7.x',
        prismaSchemaPath: 'prisma/schema.prisma',
        databaseProvider: 'postgresql',
        scripts: {},
        gitDirty: false,
        gitBranch: 'main'
      },
      filePath: file,
      content
    };

    for (const rule of rules) {
      findings.push(...rule.analyze(context));
    }
  }

  return findings;
}

export function listFiles(root: string, exclusions: string[] = fileExclusions): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const raw = relative(root, full).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (exclusions.includes(entry.name) || raw.split('/').some((part) => exclusions.includes(part))) {
          continue;
        }
        walk(full);
        continue;
      }

      if (raw.startsWith('.git/') || raw.includes('/.git/')) {
        continue;
      }

      if (/\.(ts|tsx|js|jsx|md|json)$/.test(entry.name)) {
        results.push(raw);
      }
    }
  }

  walk(root);
  return results;
}
