# Engineering Guardian CLI

Engineering Guardian (`eg`) is a local-first, deterministic quality scanner focused on Next.js and Prisma projects. It produces evidence-backed findings and can gate CI based on configured severity and confidence. It does not claim that a clean scan proves an application is secure.

## Quick start

```sh
npm install
npm run build
node dist/index.js doctor
node dist/index.js scan --format json
```

Initialize project policy with `eg init` (or `npx tsx src/index.ts init` while developing). This creates `.guardian/config.json` and manages only the marked section of `AGENTS.md`.

## Commands

```sh
eg doctor
eg scan
eg scan --changed
eg scan --changed --base origin/main --format sarif --out guardian.sarif
eg scan --path src/app/api --format json
eg explain --id EG-001-<fingerprint>
eg fix --id EG-001-<fingerprint>   # guidance/preview only
eg verify                         # discovers scripts; does not execute them
```

`scan` accepts `text`, `json`, or `sarif`. Exit codes: `0` scan passes configured gate, `1` findings breach the gate (or a requested finding is absent), `2` invalid options or scan error. `--base` requires `--changed`. Git is invoked with fixed argument arrays; no shell command from the project or model is executed.

## Current rules

| Rule | Purpose | Default |
|---|---|---|
| EG-001 | Empty catch block | P1 / high confidence |
| EG-002 | `as unknown as T` type assertion candidate | P2 / medium confidence |
| EG-003 | Prisma Client query inside loop candidate | P2 / medium confidence |

These are deliberately small heuristics, not an AST-based proof system. Review findings in context. Some syntax edge cases may be missed; use the repository's ESLint, TypeScript, tests, and security tools as complementary checks.

## Policy

`.guardian/config.json` controls scan paths and gate severity/confidence. The default gate fails on high-confidence P0/P1 only. Scan is read-only except when `--out` writes a report and `eg init` creates/updates Guardian configuration/instructions. `verify` only reports discovered scripts and does not execute them.

## Safety and limitations

- AI is disabled and no AI repair provider is implemented yet.
- `eg fix` only displays guidance; even `--apply` does not write files.
- No database connections, migrations, dependency installs, or arbitrary shell commands are performed.
- `--changed` scans Git diff paths; untracked files are not included by `git diff`.
- SARIF support is basic; validate against your CI platform before relying on it as a compliance artifact.

See [the PRD](engineering-guardian-prd.md) and [competitive gap analysis](docs/competitive-gap-analysis.md).
