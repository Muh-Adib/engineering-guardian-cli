# Competitive gap analysis (4 November 2026)

Engineering Guardian should complement established analyzers rather than recreate them. This comparison is based on public repository descriptions and the current Guardian source tree; it is a product/architecture assessment, not a feature-by-feature security audit.

| Project | Strengths to learn from | Guardian gap / response |
|---|---|---|
| [Semgrep](https://github.com/semgrep/semgrep) | Pattern-based static analysis, broad language support, mature rule ecosystem, machine-readable findings | Guardian currently has only a few narrow heuristics. Keep the core deterministic, add a safe optional adapter to reuse an already-installed scanner, and avoid claiming broad SAST coverage. |
| [Knip](https://github.com/webpro-nl/knip) | Project-graph-based unused files, exports, and dependencies with ecosystem-aware entry points | Guardian has no dependency graph/dead-code analysis. Integrate with existing project tooling or document this as an external check rather than offer a weak regex substitute. |
| [prisma-lint](https://github.com/loop-payments/prisma-lint) | Prisma schema-specific conventions and schema-aware checks | Guardian detects schema/provider only and has no schema rule pack. Add schema-aware rules only with version-aware parsing and fixtures; do not edit schemas or migrations automatically. |

## Concrete gaps found in the initial scaffold

- Stack profile was hard-coded inside scan execution, so Prisma checks could fire in unrelated repositories.
- `--changed` was a placeholder, and path selection was not available.
- CLI did not expose JSON/SARIF output or honor gate configuration.
- Scan IDs depended on line positions and were unstable after unrelated edits.
- `eg init` left an existing AGENTS.md untouched but also could not update a Guardian-managed block.
- File walking included Markdown/JSON and had fragile exclusions; report formats were disconnected from the CLI.
- `verify` could imply verification despite not executing a command.

## Implemented in this iteration

- Real project discovery passed into rule contexts; source-only recursive scans with exclusions.
- Git changed-file selection, optional base ref, explicit path selection, JSON/SARIF output and report files.
- Confidence-aware gate evaluation from `.guardian/config.json`; deterministic exit statuses.
- Stable content fingerprints, improved catch-block and Prisma-loop heuristics, and truthful verification output.
- `eg init` updates only the marked AGENTS.md region while preserving all text outside it.

## Remaining roadmap

1. AST/type-aware rules using TypeScript/ESLint APIs, with positive/negative fixtures per rule.
2. Config schema validation, baseline and expiring suppressions, SARIF schema validation.
3. Optional Semgrep/ESLint adapters with fixed executable/argument handling and no implicit installs.
4. Prisma schema parsing and Next.js version-specific rules with tested version fixtures.
5. Repair provider, secret redaction, diff validation and explicit approval (still intentionally unavailable in this MVP).
6. CI workflow and release packaging after the CLI contract and test suite stabilize.

## Research links

- https://github.com/semgrep/semgrep
- https://github.com/webpro-nl/knip
- https://github.com/loop-payments/prisma-lint
