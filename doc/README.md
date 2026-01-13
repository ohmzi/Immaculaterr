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
  - Automatically reacts to Plex library activity and runs smart workflows in real time.
- **Scheduler automation**:
  - Off hours fetching media or refreshing the Plex home screen.
- **Curated Movies and TV Shows collections**:
  - Inspired by your Immaculate Taste (long term collection)
  - Based on your recently watched (refreshes on every watch)
  - Change of Taste (refreshes on every watch)
- **Recommendation engine**:
  - TMDB-powered suggestions
  - Optional - Google + OpenAI 
- **Keeps a snapshot database:**
  - Recommmended database for refresher task to monitor titles as they become available in Plex.
- **Radarr + Sonarr integration**:
  - Seamlessly organizes your media collection and automatically sends  movies and series to ARR downloaders for monitoring and acquisition.
- **Observatory**:
  - Swipe to approve download requests (optional “approval required” mode), curate suggestions.
- **Job reports & logs**:
  - Step-by-step breakdowns, metrics tables, and run history.
- **More features on the way:**
  - Discovering Media from film industries around the world
  - Email reports on media server health

Getting Started (Docker)
---

Immaculaterr is designed to run as a single container.

```bash
docker compose -f docker/immaculaterr/docker-compose.yml pull
docker compose -f docker/immaculaterr/docker-compose.yml up -d
```

Then open `http://<server-ip>:5454/` (**production Docker port is `5454`**) and configure integrations in the UI (Plex/Radarr/Sonarr/TMDB/OpenAI/Google as desired).

Development
---

Immaculaterr is a monorepo:

- **API**: NestJS (`apps/api`) — serves the REST API under `/api`
- **Web UI**: React + Vite (`apps/web`)

```bash
npm install
npm -w apps/api run db:generate
APP_DATA_DIR=./data DATABASE_URL=file:./data/tcp.sqlite npm -w apps/api run db:migrate

# Dev ports:
# - Web UI: 5858
# - API: 5859
APP_DATA_DIR=./data DATABASE_URL=file:./data/tcp.sqlite API_PORT=5859 WEB_PORT=5858 npm run dev
```

Then open:

- Web UI: `http://localhost:5858/`
- API: `http://localhost:5859/api`

Support
---

- **Report Bug**: [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues)
- **Send Suggestion**: [Immaculaterr Feedback Form](https://forms.gle/wMpsDu9jPEY14dua6)

License
---

Immaculaterr is licensed under the **MIT License** — see [LICENSE](../LICENSE).

This project uses publicly available APIs and integrates with third‑party services (Plex, Radarr, Sonarr, TMDB, OpenAI, Google).
You are responsible for complying with their respective terms of service. Immaculaterr is not affiliated with or endorsed by those services.

