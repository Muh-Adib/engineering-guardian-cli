import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';

// Duplicated deliberately from rule-engine.ts to keep this module dependency-free;
// both lists must stay in sync.
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export function getChangedFiles(cwd = process.cwd(), base?: string): string[] {
  const toFiles = (output: string): string[] =>
    [...new Set(output.split('\0').filter(Boolean).map((file) => file.replace(/\\/g, '/')))]
      .filter((file) => SOURCE_EXTENSIONS.has(extname(file).toLowerCase()));
  try {
    // Default to HEAD so staged changes are included in the pre-commit flow;
    // `git diff <base>...HEAD` covers committed changes for the CI flow.
    const args = ['diff', '--name-only', '-z', base ? `${base}...HEAD` : 'HEAD', '--'];
    return toFiles(execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    if (base) throw error; // an invalid base ref is a hard error
    // Fresh repository without any commit yet (e.g. a pre-commit hook):
    // fall back to staged changes only.
    const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return toFiles(staged);
  }
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
