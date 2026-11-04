import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type GuardianConfig = {
  version: 1;
  project: { framework: string; orm: string };
  scan: { include: string[]; exclude: string[] };
  gate: {
    failOn: Array<'P0' | 'P1' | 'P2' | 'P3'>;
    minimumConfidence: 'low' | 'medium' | 'high';
    changedFilesOnlyInCI: boolean;
  };
  ai: { enabled: boolean; sendCode: 'never' | 'on-demand' };
  safety: {
    allowDependencyChanges: boolean;
    allowSchemaOrMigrationChanges: boolean;
    allowArbitraryCommands: boolean;
  };
};

export const defaultConfig: GuardianConfig = {
  version: 1,
  project: { framework: 'auto', orm: 'auto' },
  scan: {
    include: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.git/**', '**/.guardian/**', '**/*.generated.*']
  },
  gate: { failOn: ['P0', 'P1'], minimumConfidence: 'high', changedFilesOnlyInCI: true },
  ai: { enabled: false, sendCode: 'on-demand' },
  safety: { allowDependencyChanges: false, allowSchemaOrMigrationChanges: false, allowArbitraryCommands: false }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, fallback: string[], key: string): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Invalid Guardian config: ${key} must be an array of strings.`);
  }
  return value;
}

function booleanValue(value: unknown, fallback: boolean, key: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid Guardian config: ${key} must be a boolean.`);
  }
  return value;
}

function parseConfidence(value: unknown): GuardianConfig['gate']['minimumConfidence'] {
  if (value === undefined) return defaultConfig.gate.minimumConfidence;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new Error('Invalid Guardian config: gate.minimumConfidence must be low, medium, or high.');
}

export function parseConfig(value: unknown): GuardianConfig {
  if (!isRecord(value)) {
    throw new Error('Invalid Guardian config: expected a JSON object.');
  }
  if (value.version !== undefined && value.version !== 1) {
    throw new Error('Invalid Guardian config: only version 1 is supported.');
  }

  const project = isRecord(value.project) ? value.project : {};
  const scan = isRecord(value.scan) ? value.scan : {};
  const gate = isRecord(value.gate) ? value.gate : {};
  const ai = isRecord(value.ai) ? value.ai : {};
  const safety = isRecord(value.safety) ? value.safety : {};

  const failOnValue = gate.failOn ?? defaultConfig.gate.failOn;
  if (!Array.isArray(failOnValue) || !failOnValue.every((item) => ['P0', 'P1', 'P2', 'P3'].includes(String(item)))) {
    throw new Error('Invalid Guardian config: gate.failOn must contain only P0, P1, P2, or P3.');
  }

  const sendCode = ai.sendCode ?? defaultConfig.ai.sendCode;
  if (sendCode !== 'never' && sendCode !== 'on-demand') {
    throw new Error('Invalid Guardian config: ai.sendCode must be never or on-demand.');
  }

  return {
    version: 1,
    project: {
      framework: typeof project.framework === 'string' ? project.framework : defaultConfig.project.framework,
      orm: typeof project.orm === 'string' ? project.orm : defaultConfig.project.orm
    },
    scan: {
      include: stringArray(scan.include, defaultConfig.scan.include, 'scan.include'),
      exclude: stringArray(scan.exclude, defaultConfig.scan.exclude, 'scan.exclude')
    },
    gate: {
      failOn: failOnValue as GuardianConfig['gate']['failOn'],
      minimumConfidence: parseConfidence(gate.minimumConfidence),
      changedFilesOnlyInCI: booleanValue(gate.changedFilesOnlyInCI, defaultConfig.gate.changedFilesOnlyInCI, 'gate.changedFilesOnlyInCI')
    },
    ai: {
      enabled: booleanValue(ai.enabled, defaultConfig.ai.enabled, 'ai.enabled'),
      sendCode
    },
    safety: {
      allowDependencyChanges: booleanValue(safety.allowDependencyChanges, defaultConfig.safety.allowDependencyChanges, 'safety.allowDependencyChanges'),
      allowSchemaOrMigrationChanges: booleanValue(safety.allowSchemaOrMigrationChanges, defaultConfig.safety.allowSchemaOrMigrationChanges, 'safety.allowSchemaOrMigrationChanges'),
      allowArbitraryCommands: booleanValue(safety.allowArbitraryCommands, defaultConfig.safety.allowArbitraryCommands, 'safety.allowArbitraryCommands')
    }
  };
}

export function loadConfig(cwd = process.cwd()): GuardianConfig {
  const configPath = resolve(cwd, '.guardian/config.json');
  if (!existsSync(configPath)) return defaultConfig;

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    return parseConfig(parsed);
  } catch (error) {
    throw new Error(`Unable to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function scaffoldGuardianConfig(cwd = process.cwd()): string {
  const dir = resolve(cwd, '.guardian');
  mkdirSync(dir, { recursive: true });
  const target = resolve(cwd, '.guardian/config.json');
  if (!existsSync(target)) {
    writeFileSync(target, `${JSON.stringify(defaultConfig, null, 2)}\n`, 'utf8');
  }
  return target;
}
