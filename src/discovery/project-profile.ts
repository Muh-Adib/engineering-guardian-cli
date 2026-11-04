import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import type { ProjectProfile } from '../core/types.js';

function readJson(path: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function packageVersion(pkg: Record<string, unknown>, dependencyName: string): string | null {
  const dependencyScopes = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
  for (const scope of dependencyScopes) {
    const dependencies = pkg[scope];
    if (typeof dependencies === 'object' && dependencies !== null && !Array.isArray(dependencies)) {
      const item = (dependencies as Record<string, unknown>)[dependencyName];
      if (typeof item === 'string') return item;
    }
  }
  return null;
}

export function detectProjectProfile(cwd = process.cwd()): ProjectProfile {
  const pkgPath = resolve(cwd, 'package.json');
  const pkg = existsSync(pkgPath) ? readJson(pkgPath) : {};
  const scripts = isObject(pkg.scripts) ? Object.fromEntries(Object.entries(pkg.scripts).filter(([, value]) => typeof value === 'string')) : {};

  const prismaSchema = findPrismaSchema(cwd, pkg);
  const git = getGitState(cwd);

  return {
    packageManager: detectPackageManager(cwd),
    nodeVersion: process.version,
    typescriptDetected: existsSync(resolve(cwd, 'tsconfig.json')) || packageVersion(pkg, 'typescript') !== null,
    nextVersion: packageVersion(pkg, 'next'),
    nextAppRouter: existsSync(resolve(cwd, 'src/app')) || existsSync(resolve(cwd, 'app')),
    prismaVersion: packageVersion(pkg, 'prisma') ?? packageVersion(pkg, '@prisma/client'),
    prismaSchemaPath: prismaSchema,
    databaseProvider: detectDatabaseProvider(prismaSchema, cwd),
    scripts,
    gitDirty: git.dirty,
    gitBranch: git.branch
  };
}

export function detectPackageManager(cwd = process.cwd()): ProjectProfile['packageManager'] {
  const pkgPath = resolve(cwd, 'package.json');
  const pkg = existsSync(pkgPath) ? readJson(pkgPath) : {};
  const manager = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
  if (manager === 'npm' || manager === 'pnpm' || manager === 'yarn' || manager === 'bun') return manager;

  const candidates = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm']
  ] as const;

  const matches = candidates.filter(([file]) => existsSync(resolve(cwd, file))).map(([, value]) => value);
  return matches[0] ?? 'unknown';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findPrismaSchema(cwd: string, pkg: Record<string, unknown>): string | null {
  const prismaConfig = isObject(pkg.prisma) ? pkg.prisma : {};
  const candidates = [
    typeof prismaConfig.schema === 'string' ? prismaConfig.schema : null,
    'prisma/schema.prisma',
    'schema.prisma'
  ].filter((value): value is string => typeof value === 'string');

  for (const candidate of candidates) {
    const resolved = resolve(cwd, candidate);
    if (existsSync(resolved) && statSync(resolved).isFile()) {
      return relative(cwd, resolved).replace(/\\/g, '/');
    }
  }

  return null;
}

export function detectDatabaseProvider(schemaPath: string | null, cwd = process.cwd()): string | null {
  if (!schemaPath) return null;
  try {
    const schema = readFileSync(resolve(cwd, schemaPath), 'utf8');
    const datasourceMatch = schema.match(/datasource\s+\w+\s*\{([\s\S]*?)\}/m);
    if (!datasourceMatch) return 'unknown';
    const providerMatch = datasourceMatch[1].match(/provider\s*=\s*['"]([^'"]+)['"]/m);
    return providerMatch ? providerMatch[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

function getGitState(cwd: string): { branch: string | null; dirty: boolean } {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { branch: branch || null, dirty: status.length > 0 };
  } catch {
    return { branch: null, dirty: false };
  }
}

export function exists(target: string): boolean {
  try {
    return statSync(target).isFile() || statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function findFirstExisting(cwd: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const target = resolve(cwd, candidate);
    if (exists(target)) return relative(cwd, target).replace(/\\/g, '/');
  }
  return null;
}

export function walkFiles(root: string, exclusions: string[] = []): string[] {
  const results: string[] = [];

  function visit(dir: string): void {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (exclusions.some((pattern) => rel === pattern || rel.startsWith(pattern.replace(/\/\*\*$/, '')))) {
          continue;
        }
        visit(full);
        continue;
      }

      if (extname(entry.name).match(/\.(ts|tsx|js|jsx|mjs|cjs)$/)) {
        results.push(rel);
      }
    }
  }

  visit(root);
  return results.sort();
}
