import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Confidence, Severity } from './types.js';

export interface GuardianConfig {
  version: number;
  project: { framework: string; orm: string };
  scan: { include: string[]; exclude: string[] };
  gate: { failOn: Severity[]; minimumConfidence: Confidence; changedFilesOnlyInCI: boolean };
  ai: { enabled: boolean; sendCode: string };
  safety: { allowDependencyChanges: boolean; allowSchemaOrMigrationChanges: boolean; allowArbitraryCommands: boolean };
}

const defaultConfig: GuardianConfig = {
  version: 1,
  project: {
    framework: 'auto',
    orm: 'auto'
  },
  scan: {
    // Cover the common Next.js layouts: src/app, root app/, pages/, and a lib/ folder.
    include: [
      'src/**/*.{ts,tsx,js,jsx}',
      'app/**/*.{ts,tsx,js,jsx}',
      'pages/**/*.{ts,tsx,js,jsx}',
      'lib/**/*.{ts,tsx,js,jsx}'
    ],
    exclude: ['node_modules/**', '.next/**', 'dist/**', 'coverage/**', '.guardian/**', '**/*.generated.*']
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
  } catch (error) {
    // A broken policy file must never silently change gate behavior.
    console.error(`[eg] Warning: ${configPath} could not be parsed (${error instanceof Error ? error.message : String(error)}); using default configuration.`);
    return defaultConfig;
  }
}

export function scaffoldGuardianConfig(cwd = process.cwd()): { path: string; created: boolean } {
  const dir = resolve(cwd, '.guardian');
  mkdirSync(dir, { recursive: true });

  const target = resolve(dir, 'config.json');
  if (existsSync(target)) {
    // Never clobber a policy the user has customized.
    return { path: target, created: false };
  }

  writeFileSync(target, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');
  return { path: target, created: true };
}
