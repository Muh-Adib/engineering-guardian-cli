import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

import { getGitStatus } from '../core/git.js';
import type { ProjectProfile } from '../core/types.js';

export function detectProjectProfile(cwd = process.cwd()): ProjectProfile {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  } catch {
    // Introspection must never crash the scan; treat as an unreadable manifest.
    pkg = {};
  }

  const packageManager = detectPackageManager(cwd);
  const scripts = pkg.scripts ?? {};
  const nextVersion = typeof pkg.dependencies?.next === 'string' ? pkg.dependencies.next : typeof pkg.devDependencies?.next === 'string' ? pkg.devDependencies.next : null;
  const prismaVersion = typeof pkg.dependencies?.['@prisma/client'] === 'string' ? pkg.dependencies['@prisma/client'] : typeof pkg.devDependencies?.['@prisma/client'] === 'string' ? pkg.devDependencies['@prisma/client'] : null;

  const appRouter = exists(resolve(cwd, 'src/app')) || exists(resolve(cwd, 'app'));
  const prismaSchema = findFirstExisting(cwd, ['prisma/schema.prisma', 'schema.prisma']);
  const provider = detectDatabaseProvider(prismaSchema, cwd);
  const git = getGitStatus(cwd);

  return {
    packageManager,
    nodeVersion: process.version,
    typescriptDetected: exists(resolve(cwd, 'tsconfig.json')),
    nextVersion,
    nextAppRouter: appRouter,
    prismaVersion,
    prismaSchemaPath: prismaSchema,
    databaseProvider: provider,
    scripts,
    gitDirty: git.dirty,
    gitBranch: git.branch
  };
}

export function detectPackageManager(cwd = process.cwd()): ProjectProfile['packageManager'] {
  if (exists(resolve(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(resolve(cwd, 'yarn.lock'))) return 'yarn';
  if (exists(resolve(cwd, 'bun.lockb')) || exists(resolve(cwd, 'bun.lock'))) return 'bun';
  if (exists(resolve(cwd, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

export function detectDatabaseProvider(schemaPath: string | null, cwd = process.cwd()): string | null {
  if (!schemaPath) return null;

  const schema = readFileSync(resolve(cwd, schemaPath), 'utf8');
  if (schema.includes('provider = "postgresql"')) return 'postgresql';
  if (schema.includes('provider = "sqlite"')) return 'sqlite';
  if (schema.includes('provider = "mysql"')) return 'mysql';
  if (schema.includes('provider = "cockroachdb"')) return 'cockroachdb';
  return 'unknown';
}

export function exists(target: string): boolean {
  try {
    return !!statSync(target);
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
