# Engineering Guardian CLI

Engineering Guardian is a local-first engineering-quality CLI for Next.js 16 and Prisma projects. It performs deterministic scans, reports evidence-backed findings, and supports opt-in AI repair flows with explicit human approval.

This repository is an MVP implementation scaffold aligned to the product requirements document in `engineering-guardian-prd.md`.

## Goals

- detect project structure and stack versions without mutating the repository
- run deterministic scans for common reliability, typing, Next.js, and Prisma risks
- separate confirmed issues from contextual review suggestions
- support CLI output, JSON, and future SARIF compatibility
- keep AI-assisted repair preview-only and require explicit approval

## Quick start

```bash
npm install
npm run build
npm run doctor
npm run scan
```

## Commands

```bash
npx eg init
npx eg doctor
npx eg scan
npx eg scan --changed
npx eg explain --id EG-001
npx eg fix --id EG-001
npx eg verify
```

## Current status

This repository contains the core MVP skeleton and initial rule engine. The implementation is intentionally deterministic and rules-driven, with clear extension points for version-aware Next.js and Prisma checks.

## Project structure

- `src/cli` — command parsing and UX
- `src/core` — config and finding types
- `src/discovery` — project detection
- `src/analyzers` — deterministic scan rules
- `src/reporters` — terminal and machine output
- `src/templates` — config and AGENTS scaffolding

## Safety model

- AI actions are disabled by default
- patch generation is preview-only
- no arbitrary shell execution is permitted
- findings are evidence-based and confidence-aware

## Documentation

See `engineering-guardian-prd.md` for the full product requirements and implementation plan.
