import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

import type { ProjectProfile } from '../core/types.js';

export function detectProjectProfile(cwd = process.cwd()): ProjectProfile {
  const pkgPath = resolve(cwd, 'package.json');
  const pkg = exists(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};

  const packageManager = detectPackageManager(cwd);
  const scripts = pkg.scripts ?? {};
  const nextVersion = typeof pkg.dependencies?.next === 'string' ? pkg.dependencies.next : typeof pkg.devDependencies?.next === 'string' ? pkg.devDependencies.next : null;
  const prismaVersion = typeof pkg.dependencies?.['@prisma/client'] === 'string' ? pkg.dependencies['@prisma/client'] : typeof pkg.devDependencies?.['@prisma/client'] === 'string' ? pkg.devDependencies['@prisma/client'] : null;

  const appRouter = exists(resolve(cwd, 'src/app')) || exists(resolve(cwd, 'app'));
  const prismaSchema = findFirstExisting(cwd, ['prisma/schema.prisma', 'schema.prisma']);
  const provider = detectDatabaseProvider(prismaSchema, cwd);

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
    gitDirty: false,
    gitBranch: null
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

export function walkFiles(root: string, exclusions: string[] = []): string[] {
  const results: string[] = [];

  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (exclusions.some((pattern) => rel === pattern || rel.startsWith(pattern.replace(/\/\*\*$/, '')))) {
          continue;
        }

        visit(full);
        continue;
      }

      if (extname(entry.name).match(/\.(ts|tsx|js|jsx|md|json)$/)) {
        results.push(rel);
      }
    }
  }

  visit(root);
  return results;
}
