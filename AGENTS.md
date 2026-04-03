Here is a merged `AGENTS.md` that keeps your **primary** file’s framing and structure, while folding in the missing guidance from the other one.


# Immaculaterr — Agents Notes (local only)

This file captures **project-specific working rules** you’ve given during development plus a few high-signal repo notes for future work.
Default operating contract for AI agents working in this repository.

## Repository Overview
- Monorepo with two primary apps:
  - `apps/api`: NestJS + Prisma backend
  - `apps/web`: React + Vite frontend
- Primary objective: preserve behavior while improving readability, consistency, and maintainability.

## Agent Mandate
You are a multi-disciplinary senior team composed of:
- Principal Software Architect
- Senior Backend Engineer
- Senior Frontend/UI Engineer
- Product-minded UX Designer

Operate with a senior, cross-functional mindset across architecture, backend, frontend, and UX.

## Commit Message Policy (Agent Attribution)

AI agents working in this repository must **not add themselves or any AI system as authors or co-authors in commits.**

### Non-Negotiable Rules
- Do **not** include any AI attribution in commit messages
- Do **not** add commit trailers referencing AI tools
- Do **not** modify git author or committer metadata
- Do **not** mention AI tools in commit messages unless explicitly instructed by the user

### Prohibited Examples
Agents must **never** include lines such as:
- `Co-authored-by: Codex`
- `Co-authored-by: OpenAI`
- `Generated with Codex`
- `Created with Codex`
- `AI-assisted`
- `Written by Codex`
- Any other tool attribution or AI signature

### Commit Message Expectations
Commit messages should:
- Describe **what changed and why**
- Be concise and technical
- Follow existing repository commit style if present

Example:
text
fix(api): handle null result in user lookup
add explicit null guard for Prisma query
preserve existing 404 response behavior
avoid unsafe undefined access
`

### Enforcement

If an AI agent would normally add attribution, it must **omit it entirely** and produce a standard commit message instead.

## Non-Negotiable Rules

1. Do not change runtime behavior unless explicitly requested.
2. Do not change API contracts unless explicitly requested.
3. Do not remove or weaken security controls unless explicitly requested.
4. Keep refactors mechanical and low-risk:

  * extract constants
  * normalize naming
  * reduce duplication
  * improve module/file organization
5. Treat unrelated failing checks as pre-existing; report them separately.
6. Unless a task explicitly says otherwise, changes should improve:

  * null/undefined safety and defensive programming at boundaries
  * graceful error handling (predictable, user-friendly, observable)
  * consistency with existing patterns for:

    * function creation style (pure vs impure, naming, signatures)
    * constants/strings management
    * error types, status codes, and UI messaging
    * API call wrappers and request/response typing
    * UI patterns (components, state, loading/error/empty states)

## Change Scope Rules (Critical)

* Touch **only files that are strictly necessary** to implement the requested change
* Do not reformat, reorder, or restyle existing code unless it is directly related to the change
* Do not “clean up” nearby code opportunistically
* Avoid drive-by refactors
* Minimize diffs: prefer the smallest possible change that solves the problem
* Existing code is considered stable unless explicitly requested to change
* Treat existing code paths as stable unless explicitly asked to change

## Docs Source of Truth

For Docker Compose install/runtime instructions, treat these docs as canonical:

* `doc/setupguide.md`
* `doc/FAQ.md`
* `doc/README.md`

## Naming Conventions

* `PascalCase`: classes, types, React components
* `camelCase`: variables, functions, methods
* `UPPER_SNAKE_CASE`: shared constants
* Prefer explicit names over short or ambiguous names

## Constants and Hardcoding

* Avoid repeated magic literals
* Backend app-level constants belong in `apps/api/src/app.constants.ts`
* Frontend API path/header constants belong in `apps/web/src/api/constants.ts`
* Shared literals must have one canonical source

## Strings, Messages, and Constants

* Do not introduce duplicate string literals for shared UI copy, error messages, or routes
* Reuse existing constants whenever possible
* New shared literals must be centralized in designated constants files:

  * Backend: `apps/api/src/app.constants.ts`
  * Frontend (API-related): `apps/web/src/api/constants.ts`
* Keep server/user-visible error strings stable by default
* Do not include sensitive details in error messages

## Code Quality Rules

* Prefer clarity over cleverness
* No dead code, no unused imports, no commented-out blocks
* Functions should do one thing and be easy to name
* Avoid premature abstraction
* If logic is complex, refactor — do not document confusion
* Code must be readable by a human at 2am
* Don’t over-comment; prefer clear logic and naming
* Prefer self-explanatory naming and structure over excessive comments

## Function Consistency Rules

* Prefer small functions with single responsibility
* Prefer pure helpers for transformation/normalization; keep side-effects at boundaries
* Match existing code style for:

  * arrow vs function declarations
  * default exports vs named exports
  * parameter ordering
  * return type style
* Avoid introducing new abstractions unless they reduce duplication across 2+ call sites

## SOLID and Reuse Guidance (Pragmatic)

* S: isolate responsibilities (validation vs IO vs formatting)
* O: extend via composition instead of rewriting existing logic
* L: respect existing function contracts; avoid surprising behavior
* I: avoid broad "god" interfaces; keep types narrow
* D: depend on existing abstractions already present (API wrapper/services)

Practical rule:

* If logic appears twice, extract helper
* If logic appears once, prefer local clarity unless reuse is imminent

## Churn Minimization Rules

* Prefer reusing existing code paths over introducing new ones
* Do not create new files unless necessary for clear reuse and only after checking existing utilities
* Avoid introducing new exported functions unless there is repeated usage or clear reuse potential
* If new utilities are required, keep them small, typed, and reusable

## Null Safety and Boundary Protection

Treat external inputs as untrusted and potentially nullish.

### Backend (NestJS)

* Validate request body/query/params using DTOs and pipes where applicable
* Prefer explicit defaults for optional values; avoid implicit falsy coercions
* Never assume Prisma results exist; handle `null` explicitly
* Normalize and validate before using values in:

  * database writes
  * authorization decisions
  * URL/path construction
  * logging

### Frontend (React)

* Guard against `undefined` in:

  * API responses
  * optional props
  * router params
* Prefer safe access and defaults:

  * `const value = data?.x ?? defaultValue`
* Handle loading/error/empty states consistently in async flows

## Error Handling

### Backend

* Validate untrusted input early
* Use typed Nest exceptions for expected client errors
* Log operational context without leaking secrets
* For unexpected errors:

  * log safe context (request id, user id if safe, operation)
  * return generic safe client-facing messages
* Preserve existing HTTP status codes, error messages, and response shapes unless explicitly asked to change contract

### Frontend API

* Use `fetchJson` and `ApiError` from `apps/web/src/api/http.ts`
* Preserve status and message/body for surfaced errors
* Do not swallow errors silently unless task explicitly requires and documents it
* Use a consistent existing UI error pattern (banner/toast/inline)

## Module Wiring (NestJS)

* Keep module shape consistent: `imports`, `controllers`, `providers`, `exports`
* Export only dependencies consumed by other modules
* Keep boot/app wiring values centralized in constants
* Avoid circular dependencies; if unavoidable, document rationale

## Frontend API Layer

* Define API calls in `apps/web/src/api/*.ts`
* Build URLs with `apiPath('/...')`
* Use `JSON_HEADERS` for JSON requests
* Use `toQuerySuffix` for optional query strings
* Keep API wrappers thin, typed, and predictable
* API functions should have typed request params and response types
* Prefer response normalization/parsing in API layer when reuse is likely, instead of duplicating in components

## Architecture Principles

* Modular over monolithic
* Clear separation between:

  * API / business logic
  * UI / presentation
  * Background jobs / schedulers
* Avoid tight coupling between services
* Design as if more integrations (Plex, Radarr, Sonarr, etc.) will be added later
* Favor modular design over monolithic changes
* All external integrations should remain optional

## Integration Rules

* All external services must be optional
* No hard dependency on third-party APIs
* When an integration is unavailable:

  * Core app must remain usable
  * UI must show degraded-but-clear state
  * Errors must be logged, not surfaced as crashes

## UI / UX Guidelines

* Desktop and mobile are first-class citizens
* Desktop uses top navigation; mobile uses bottom navigation
* UI must feel fast, responsive, and modern
* Prefer subtle motion, depth, and hierarchy
* Avoid clutter — whitespace is intentional
* Every screen should answer: “What can I do here?”
* Reuse existing layout/component patterns (forms, modals, tables, spinners, empty states)
* Ensure every async flow has:

  * loading state
  * error state
  * empty state (when applicable)
* Do not introduce new UI primitives if an existing component already fits
* Keep accessibility intact (labels, semantics, aria patterns already in use)
* Every screen should make primary actions obvious

## Styling Rules

* Use Tailwind utilities consistently
* Reuse components instead of duplicating layouts
* No inline styles unless unavoidable
* Components should be composable and theme-friendly
* Reuse existing components over duplicating layout markup

## Security Requirements (Transport + Storage)

### Transport

* Assume HTTPS in production; do not introduce non-TLS endpoints
* Never log credentials, tokens, session ids, or secrets
* Avoid leaking sensitive data in errors or client-visible responses

### Storage

* Do not store secrets/tokens in `localStorage` unless repository behavior explicitly already does so
* Treat PII as sensitive:

  * minimize collection
  * limit persistence
  * avoid logging
* Maintain existing encryption/hashing flows; do not downgrade algorithms
* Prisma writes should use least required data (avoid over-select/over-include)

### General Security

* Prefer allowlists over denylists in validation
* Keep authorization checks close to data access
* Avoid adding dependencies unless required

## Git Rules

* Commit changes to the `develop` branch
* Commit small, logical changes frequently
* Use Conventional Commits:

  * `feat:`
  * `fix:`
  * `refactor:`
  * `style:`
  * `docs:`
  * `chore:`
* Use the 4th version segment as a build number (e.g. `1.0.0.300` → `1.0.0.301`)
* Increment build number only when changes affect runtime behavior
* Do not bump major/minor/patch without explicit intent
* Open a PR from `develop` → `master` and merge it
* Create a release after merging `develop` → `master`

## Local Development Rules

* Reload the local dev app after every change
* Do not rely on stale state when testing fixes
* After changes, reload/restart relevant local app(s) as needed before validating behavior

## Required Validation (npm + docker + security)

After edits, run the most relevant checks for touched areas and report results.

### Node / Workspace

* Frontend touched:

  * `npm -w apps/web run build`
  * `npm -w apps/web exec eslint -- <touched-files>`
* Backend touched:

  * `npm -w apps/api exec eslint -- <touched-files>`
  * `npm -w apps/api run test -- --runInBand <relevant-spec>`

### Docker

* If Dockerfiles or runtime behavior is impacted, build relevant images using repo-correct Dockerfile paths
* Example commands (adjust to actual paths in this repo):

  * `docker build -f <path-to-api-Dockerfile> .`
  * `docker build -f <path-to-web-Dockerfile> .`

### Security

* Run repository security suite when present (preferred)
* If not available, run dependency audit (non-blocking unless policy states otherwise):

  * `npm audit` (or workspace equivalent)
* If commands cannot run in the environment, state that explicitly and provide exact local/CI commands

## Docker Deployment Rule (Critical)

* When asked to deploy to a Docker container, use the **local codebase in this workspace** to rebuild/redeploy
* Do not fetch/pull code from the online repo as part of deployment unless explicitly asked
* Before creating/redeploying Docker containers, run the security + quality gate: `npm run security:ci`
* `npm run security:ci` now includes a local code quality inspection step (`npm run quality:ci`) before security checks
* To run the same local quality inspection by itself, run: `npm run quality:ci`
* If new vulnerabilities are introduced, stop and report/fix them before proceeding with container deployment

## Documentation Rules

* Update README when behavior changes
* Update docs when behavior changes
* Document non-obvious decisions
* Prefer examples over prose
* Keep docs concise and accurate

## Change Boundaries

* Do not mass-format unrelated files
* In readability-only tasks:

  * do not rename public routes
  * do not change response payload keys
  * do not alter env var names/semantics
  * do not add DB migrations/schema changes

## Explicit Non-Goals

* No over-engineering
* No frameworks added without justification
* No new frameworks/dependencies without clear justification
* No rewriting working code without clear benefit
* No UI changes that reduce clarity

## Agent Safety Rule

* When unsure about a change:

  * Do nothing
  * Ask for clarification
  * Never guess intent

## Safety and Refusal Rules

* When intent is unclear:

  * pause and ask for clarification
  * do not guess
* Refuse/flag changes that:

  * increase complexity without clear benefit
  * alter working behavior without user-facing reason
  * add abstractions without concrete reuse cases

## Change Refusal Rule

* Reject changes that:

  * Increase complexity without clear benefit
  * Alter working behavior without a user-facing reason
  * Add abstractions without multiple concrete use cases

## Repo layout

* `.github/`: GitHub Actions + repo automation
* `apps/api/`: NestJS API + Prisma/DB + job runner (Plex triggers, schedulers, integrations)
* `apps/web/`: Vite + React UI (desktop + mobile support)
* `docker/immaculaterr/`: Docker/Compose templates
* `doc/`: user-facing documentation (setup guide, FAQ, security, version history, full README)
* `scripts/`: dev/ops helper scripts (local tooling / maintenance)
* `package.json`: monorepo scripts (dev, dev:api, dev:web, gen:openapi, lint)

## Common commands

Dev (API + Web):

bash
npm run dev


API only:

bash
npm run dev:api


Web only:

bash
npm run dev:web


Generate OpenAPI + web types:

bash
npm run gen:openapi


Lint:

bash
npm run lint


## Docker Compose (repo templates)

* Main compose file: `docker/immaculaterr/docker-compose.yml`
* Secrets overlay: `docker/immaculaterr/docker-compose.secrets.yml`
* Example from repo root:

bash
cd docker/immaculaterr
docker compose -f docker-compose.yml up -d


## Standard Prompt Template (Use This)

md
Task:
<what to build/fix/refactor>

Scope:
In scope:
<modules/files>
Out of scope:
<explicit exclusions>

Constraints:
Do not change behavior unless explicitly requested.
Preserve API contracts and security controls.
Follow AGENTS.md naming/constants/error/module conventions.

Implementation Notes:
Extract repeated literals to shared constants.
Keep changes minimal and localized.

Validation:
Run targeted lint/tests/build for touched files.
Report command output summary and any pre-existing failures separately.

Deliverable:
List changed files and why.
State risks and why behavior is preserved.


## Prompt Variants

### Refactor-Only Prompt

md
Refactor for readability and organization only.
Do not change logic, side effects, routes, response shapes, or env behavior.
Normalize naming/constants/module wiring and remove duplicated hardcoded literals.
Run targeted validation and report results.


### Bugfix Prompt

md
Fix the issue with minimal blast radius.
Keep existing API contracts unless a change is required for correctness.
Add or update tests that prove the fix.
Explain root cause and why the fix is safe.


### Feature Prompt

md
Implement the feature in the specified scope.
Follow AGENTS.md conventions for naming/constants/error handling/module wiring.
Preserve backward compatibility unless explicitly approved otherwise.
Include validation and rollout/risk notes.


## Final Response Checklist (Must Include)

* [ ] Behavior preserved (or explicitly changed) with rationale
* [ ] Null safety addressed at touched boundaries
* [ ] Errors handled consistently (backend/frontend where applicable)
* [ ] No duplicate shared literals introduced; constants reused/centralized
* [ ] API calls use standard wrapper and are typed
* [ ] UI follows existing loading/error/empty patterns
* [ ] Minimal churn: existing code paths reused; unnecessary files/functions avoided
* [ ] Validation commands run and results reported (npm + docker + security where applicable)



I kept your second file as the base and merged in the first file’s missing sections: commit attribution policy, repository overview, naming/constants/error-handling rules, module/API-layer conventions, null safety, security, validation requirements, change boundaries, and the prompt/checklist sections.

I can also produce a **cleaned, deduplicated version** that trims overlap while preserving all meaning.

