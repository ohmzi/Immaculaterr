Immaculaterr
===

[![Build Status](https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-ghcr.yml/badge.svg)](https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-ghcr.yml)
[![Latest Release](https://img.shields.io/github/v/release/ohmzi/Immaculaterr)](https://github.com/ohmzi/Immaculaterr/releases)
[![License](https://img.shields.io/github/license/ohmzi/Immaculaterr)](../LICENSE)
[![GitHub Downloads](https://img.shields.io/github/downloads/ohmzi/Immaculaterr/total)](https://github.com/ohmzi/Immaculaterr/releases)

Immaculaterr is a **Plex “autopilot”** that watches what you’re watching, generates recommendations, and keeps your library tidy.
It builds curated Plex collections (with proper artwork), can optionally send missing titles to Radarr/Sonarr, and gives you detailed run reports so you always know what happened.

Major Features Include
---

- **Plex-triggered automation (no webhook setup required)**: Detects “finished watching” via Plex polling, then runs tasks automatically.
- **Curated collections you actually want to open**:
  - “Inspired by your Immaculate Taste” (Movies + TV)
  - “Based on your recently watched movie/show”
  - “Change of Taste”
- **Poster artwork included**: Collections use the matching posters shipped in `assets/collection_artwork/posters`.
- **Recommendation engine**:
  - TMDB-powered “similar” suggestions
  - Optional Google + OpenAI enrichment (still shows “not enabled” / “skipped” when off)
- **Keeps a snapshot database** for watched-based collections (active/pending) so refreshers can activate titles once they arrive in Plex.
- **Refresher jobs**: Re-check pending items, activate what’s now available, shuffle active items, and rebuild collections cleanly.
- **Radarr + Sonarr integration** (optional per job): “Fetch Missing items” toggles let you decide whether jobs can send titles to ARR downloaders.
- **Cleanup After Adding New Content**: Manual/scheduled cleanup that dedupes across libraries and unmonitors duplicates in Radarr/Sonarr (with episode/season-aware rules).
- **Confirm Monitored**: Keeps ARR monitoring aligned with what’s already in Plex.
- **Job system with strong observability**:
  - Step-by-step breakdown cards
  - Metrics tables + expandable lists
  - Logs and run history (Rewind)
- **Resilient external calls**: Built-in retry for flaky APIs (3 attempts, 10s wait) where it matters.
- **Built for Docker**: Single container that serves both the API and the Web UI on one port.
- **Update awareness**: The app can check for newer releases and shows an in-app reminder to update your container.

Getting Started (Docker)
---

Immaculaterr is designed to run as a single container.

```bash
docker compose -f docker/immaculaterr/docker-compose.yml pull
docker compose -f docker/immaculaterr/docker-compose.yml up -d
```

Then open `http://<server-ip>:3210/` and configure integrations in the UI (Plex/Radarr/Sonarr/TMDB/OpenAI/Google as desired).

Development
---

Immaculaterr is a monorepo:

- **API**: NestJS (`apps/api`) — serves the REST API under `/api`
- **Web UI**: React + Vite (`apps/web`)

```bash
npm install
npm -w apps/api run db:generate
APP_DATA_DIR=./data DATABASE_URL=file:./data/tcp.sqlite npm -w apps/api run db:migrate
npm run dev
```

Support
---

- **Report Bug**: [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues)
- **Send Suggestion**: [Immaculaterr Feedback Form](https://forms.gle/wMpsDu9jPEY14dua6)

License
---

Immaculaterr is licensed under the **MIT License** — see [LICENSE](../LICENSE).

This project uses publicly available APIs and integrates with third‑party services (Plex, Radarr, Sonarr, TMDB, OpenAI, Google).
You are responsible for complying with their respective terms of service. Immaculaterr is not affiliated with or endorsed by those services.

