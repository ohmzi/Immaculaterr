# Contributing

Thanks for helping improve Immaculaterr.

Contributions are welcome, whether you'd like to fix a reported bug or add a new feature.

Please note: all pull requests are reviewed by the original maintainer, who may accept, request changes to, or decline a PR to keep the project aligned with its direction and quality standards.

## Quick notes

- Please open issues for bugs and feature requests (templates will guide you).
- The project uses a `develop` → `master` flow. Changes should land in `develop` first.
- Keep PRs focused and small when possible.

## Development setup

See: [`SETUPGUIDE.md`](https://github.com/ohmzi/Immaculaterr/blob/develop/doc/setupguide.md#run-from-a-cloned-repository)

## CI requirements

All pull requests must pass the `quality-and-security` CI check before merge. The check runs:

- **Lint** -- `npm run lint` (both workspaces)
- **Build** -- `npm run build` (TypeScript + Vite)
- **Unit tests** -- `npm run test` (Jest, including all security specs in `apps/api/src/tests/security/`)
- **AJV safety check** -- `npm run security:check:ajv` (blocks `$data: true` patterns)
- **Dependency audit** -- `npm run security:audit:prod` (npm audit at `--audit-level=high` for production deps)

To run all checks locally before pushing:

```bash
npm run security:ci
```

Security-relevant code changes must have corresponding security specs in `apps/api/src/tests/security/`.

## Pull requests

- Describe the \u201cwhy\u201d and the \u201cwhat\u201d.
- Include screenshots for UI changes.
- Mention how you tested (Docker, local dev, etc.).

## Reporting security issues

Preferred: [SECURITY.md](https://github.com/ohmzi/Immaculaterr/edit/master/.github/SECURITY.md)

Fallback: [Issues](https://github.com/ohmzi/Immaculaterr/issues)
