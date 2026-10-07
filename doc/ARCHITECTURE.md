Architecture
===

How Immaculaterr is put together: the recommendation engine, the tech stack, and the repository layout.

[← Back to README](../README.md)

How recommendations are built
---

1. A watch event, manual run, or history import supplies a seed title, and the app builds a richer seed profile from it.
2. TMDB pulls fuller metadata and candidate pools, including standard picks plus wildcard lanes for global-language films and hidden gems.
3. A multi-factor ranking engine scores candidates using similarity, quality, novelty, and indie/popularity signals.
4. Ranking weights change by intent, so latest-watched and change-of-taste runs do not rank titles the same way, and released vs. upcoming mixes can be tuned separately.
5. Final picks are interleaved so core recommendations stay strong while wildcard discoveries add variety.

Tech stack
---

| Layer | Technology |
| --- | --- |
| **Backend** | TypeScript, Node.js 20+, NestJS, Prisma, SQLite, OpenAPI |
| **Frontend** | React 19, Vite, Tailwind CSS, Radix UI, TanStack Query, React Router |
| **Delivery and quality** | Docker, Caddy (optional HTTPS sidecar), GitHub Actions, Jest, Cypress |

Project structure
---

```text
Immaculaterr/
├── apps/
│   ├── api/          # NestJS API — jobs, integrations, Prisma schema, OpenAPI
│   └── web/          # React + Vite single-page app
├── cypress/          # End-to-end tests
├── doc/              # Setup guides, FAQ, security policy, screenshots
├── docker/           # Dockerfile, compose files, Caddy HTTPS sidecar
├── scripts/          # Development and release tooling
├── security/         # Security scanners, audits, scorecard
└── .github/          # CI quality gates and container publishing workflows
```
