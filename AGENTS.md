# Project-specific engineering guidance

This file is managed by Engineering Guardian only inside the markers below.

<!-- ENGINEERING_GUARDIAN:START -->
## Engineering Guardian

- Run `eg doctor` to inspect the detected project stack and versions.
- Run `eg scan` before major edits and `eg scan --changed` before commit review.
- Treat P0/P1 findings as blocking only when high confidence and explicitly configured in `.guardian/config.json`.
- AI-assisted repair is preview-only; apply only with explicit developer approval.
- Do not run arbitrary shell commands or make schema or dependency changes without approval.
- Preserve user changes and dirty worktree state; do not overwrite those edits.
<!-- ENGINEERING_GUARDIAN:END -->
