# Engineering Guardian product requirements

This file stores the MVP specification and implementation direction for Engineering Guardian as a local-first Next.js + Prisma engineering-quality tool.

## Core product principle

Engineering Guardian should not merely report that code is bad. It must show verifiable evidence, distinguish certainty from suspicion, help produce a safe repair, verify the result, and turn approved recurring lessons into enforceable engineering rules.

## Executive summary

Engineering Guardian (EG) is a lightweight engineering-quality tool for Next.js 16 and Prisma projects. It scans a repository for code-quality, reliability, security, data-integrity, performance, and maintainability risks; reports evidence-backed findings; optionally uses an LLM to explain or propose a repair; and verifies approved changes using the repository's existing quality gates.

The core principle is deterministic detection first, AI assistance second. Static rules, TypeScript/ESLint analysis, and optional security scanners perform repeatable checks without API cost. AI is invoked only when a developer requests contextual explanation or a repair proposal. The developer reviews and approves every AI-generated patch.

See the main project documentation in `README.md` for the implementation scaffold and usage.
