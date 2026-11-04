import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const defaultConfig = {
  version: 1,
  project: {
    framework: 'auto',
    orm: 'auto'
  },
  scan: {
    include: ['src/**/*.{ts,tsx,js,jsx}'],
    exclude: ['node_modules/**', '.next/**', 'dist/**', 'coverage/**']
  },
  gate: {
    failOn: ['P0', 'P1'],
    minimumConfidence: 'high',
    changedFilesOnlyInCI: true
  },
  ai: {
    enabled: false,
    sendCode: 'on-demand'
  },
  safety: {
    allowDependencyChanges: false,
    allowSchemaOrMigrationChanges: false,
    allowArbitraryCommands: false
  }
};

export type GuardianConfig = typeof defaultConfig;

export function loadConfig(cwd = process.cwd()): GuardianConfig {
  const configPath = resolve(cwd, '.guardian/config.json');

  if (!existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<GuardianConfig>;
    return {
      ...defaultConfig,
      ...parsed,
      project: { ...defaultConfig.project, ...parsed.project },
      scan: { ...defaultConfig.scan, ...parsed.scan },
      gate: { ...defaultConfig.gate, ...parsed.gate },
      ai: { ...defaultConfig.ai, ...parsed.ai },
      safety: { ...defaultConfig.safety, ...parsed.safety }
    };
  } catch {
    return defaultConfig;
  }
}

export function scaffoldGuardianConfig(cwd = process.cwd()): string {
  const dir = resolve(cwd, '.guardian');
  mkdirSync(dir, { recursive: true });

  const target = resolve(dir, 'config.json');
  writeFileSync(target, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');

  return target;
}
