export type Severity = 'P0' | 'P1' | 'P2' | 'P3';
export type Confidence = 'high' | 'medium' | 'low';
export type FixMode = 'none' | 'safe' | 'assisted';

export interface Location {
  file: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: Confidence;
  category: string;
  location: Location;
  evidence: string;
  impact: string;
  recommendation: string;
  fixMode: FixMode;
  references?: string[];
}

export interface ProjectProfile {
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  nodeVersion: string | null;
  typescriptDetected: boolean;
  nextVersion: string | null;
  nextAppRouter: boolean;
  prismaVersion: string | null;
  prismaSchemaPath: string | null;
  databaseProvider: string | null;
  scripts: Record<string, string>;
  gitDirty: boolean;
  gitBranch: string | null;
}

export interface RuleContext {
  project: ProjectProfile;
  filePath: string;
  content: string;
}

export interface GuardianRule {
  id: string;
  category: string;
  defaultSeverity: Severity;
  analyze: (context: RuleContext) => Finding[];
}
