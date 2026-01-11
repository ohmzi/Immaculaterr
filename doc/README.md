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

- **Plex-triggered automation**:
  - Detects what you’re watching and automatically triggers actions as you finish the movies or TV episodes.
- **Curated collections you actually want*:
  - “Inspired by your Immaculate Taste”
  - “Based on your recently watched”
  - “Change of Taste”
- **Recommendation engine**:
  - TMDB-powered suggestions
  - Optional Google + OpenAI enrichment
- **Refresher**: Re-check pending items, activate what’s now available, shuffle active items, and rebuild collections.
- **Radarr + Sonarr integration**: Fetch Missing items using ARR downloaders.
- **Cleanup After Adding New Content**: Manual/scheduled cleanup duplicates across libraries and unmonitors them in Radarr/Sonarr.
- **Confirm Monitored**: Keeps ARR monitoring aligned with what’s already in Plex.
- **Job system with strong observability**:
  - Step-by-step breakdown cards
  - Metrics tables + expandable lists
  - Logs and run history

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

