# Agent instructions (project workflow)

This file documents how the coding agent should work in this repo.

## Git discipline (required)

- **Commit after each meaningful change-set** (feature, fix, refactor), not at the very end.
- **Write a “worthy” commit message**:
  - Use an imperative subject line (e.g. “Add …”, “Fix …”, “Refactor …”).
  - Keep the subject short; put details in the body if needed.
  - Prefer a conventional prefix when it fits: `feat:`, `fix:`, `refactor:`, `chore:`.
- **Keep commits buildable**: don’t commit a broken build or failing typecheck.
- When work is complete on a feature branch, **merge into `main`** (fast‑forward or merge commit as appropriate) and keep `main` green.

## Security hygiene

- **Never commit secrets** (API keys, tokens, passwords) or any exported app data.
- Prefer `.env` templates and redacted examples.


