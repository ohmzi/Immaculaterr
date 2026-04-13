Immaculaterr
===

[![Publish containers (GHCR + Docker Hub)](https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-containers.yml/badge.svg?branch=master)](https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-containers.yml)
[![Latest Release](https://img.shields.io/github/v/release/ohmzi/Immaculaterr)](https://github.com/ohmzi/Immaculaterr/releases)
[![License](https://img.shields.io/badge/license-custom%20terms-blue)](../LICENSE)
[![GHCR Downloads](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ohmzi/Immaculaterr/develop/doc/assets/badges/ghcr-package-downloads.json&cacheSeconds=300)](https://github.com/ohmzi/Immaculaterr/pkgs/container/immaculaterr)
[![Docker Pulls](https://img.shields.io/docker/pulls/ohmzii/immaculaterr)](https://hub.docker.com/r/ohmzii/immaculaterr)

Immaculaterr is a **Plex “autopilot”** that watches what you’re watching, generates recommendations, and keeps your library tidy.
It builds curated Plex collections (with proper artwork), can optionally send missing titles to Radarr/Sonarr or Seerr, and gives you detailed run reports so you always know what happened.

Official Docker images and release artifacts are the supported public distribution channel. The public source repository remains visible for transparency and reference, but the source code is not licensed for general reuse.

Major Features Include
---

- **Seerr integration (optional centralized request flow)**:
  - Route missing movie/TV requests to Seerr instead of direct ARR sends.
  - Works per task card, so you can choose where missing titles go.
  - Includes Command Center reset control to clear all Seerr requests when needed.
- **Plex-triggered automation**:
  - Automatically reacts to Plex library activity and runs smart workflows in real time.
- **Scheduler automation**:
  - Off hours fetching media or refreshing the Plex home screen.
- **Shared persisted job queue**:
  - Manual runs, schedules, Plex webhooks, and Plex polling all feed into one FIFO queue.
  - After each run, Immaculaterr waits about 1 minute before the next queued job starts so Plex and upstream services get a breather.
  - Pending work survives restarts, duplicate auto-runs are skipped cleanly, and Rewind shows queued/running status with ETA context.
- **Curated Movies and TV Shows collections**:
  - Inspired by your Immaculate Taste (long term collection)
  - Based on your recently watched (auto-refreshes for newly completed movies/episodes)
  - Change of Taste (auto-refreshes for newly completed movies/episodes)
  - Fresh Out Of The Oven (recent-release movies you have not watched yet, per Plex user)
  - Fresh Out Of The Oven Show (recent TV premieres you have not watched yet, per Plex user)
- **Recommendation engine**:
  - TMDB-powered suggestions
  - Optional - Google + OpenAI 
- **TMDB Upcoming Movies task filters**:
  - Build custom filter sets with where-to-watch, genre, language, certification, and score controls.
- **Rotten Tomatoes Upcoming Movies task**:
  - Scrapes fixed Rotten Tomatoes upcoming and newest movie pages, deduplicates safe matches, and routes them to Radarr or Seerr.
  - Includes a `Route via Seerr` toggle in Task Manager. Off adds matched movies to Radarr; on requests matched movies in Seerr instead.
  - Matching still uses the same conservative Radarr lookup step first, so only safe title/year matches are routed.
- **Keeps a snapshot database:**
  - Recommmended database for refresher task to monitor titles as they become available in Plex.
- **Radarr + Sonarr integration**:
  - Seamlessly organizes your media collection and sends movies/series directly to ARR downloaders when Seerr mode is off.
- **Observatory**:
  - Swipe to approve download requests (optional “approval required” mode), curate suggestions.
- **Netflix Watch History Import**:
  - Upload your Netflix viewing activity CSV to classify titles via TMDB, generate recommendations, and write curated Plex collections.
  - Seed recommendations from day one without waiting for Plex watch events to accumulate.
- **Plex Watch History Import**:
  - Opt in during setup or trigger manually from Task Manager to scan your existing Plex watch history.
  - Watched movies and TV shows are matched to TMDB automatically (no CSV needed), then fed into the recommendation pipeline to build curated Plex collections.
  - Cross-source dedup ensures titles already processed by Netflix import are not duplicated.
- **Job reports & logs**:
  - Step-by-step breakdowns, metrics tables, run history, and live queue visibility in Rewind.
  - Recommendation sets now use a stronger ranking engine that blends similarity, quality, novelty, and indie/popularity signals.
- **More features on the way:**
  - Email reports on media server health
  - Windows and macOS support

How Recommendations Are Built
---

1. A watch event, manual run, or history import supplies a seed title, and the app builds a richer seed profile from it.
2. TMDB pulls fuller metadata and candidate pools, including standard picks plus wildcard lanes for global-language films and hidden gems.
3. A multi-factor ranking engine scores candidates using similarity, quality, novelty, and indie/popularity signals.
4. Ranking weights change by intent, so latest-watched and change-of-taste runs do not rank titles the same way, and released vs. upcoming mixes can be tuned separately.
5. Final picks are interleaved so core recommendations stay strong while wildcard discoveries add variety.

Screenshots
---

**Desktop UI**

<div align="center">
  <img src="assets/screenshots/showcase.gif" alt="Immaculaterr desktop UI showcase" width="900" />
</div>

**Plex UI examples**

<div align="center">
  <img src="assets/screenshots/plex-immaculate-taste-mobile.png" alt="Plex mobile screenshot showing Immaculaterr recommendations" width="320" />
  <br/>
  <br/>
  <img src="assets/screenshots/plex-immaculate-taste-desktop.png" alt="Plex desktop screenshot showing Immaculaterr recommendations" width="900" />
</div>

**Mobile UI (full mobile support)**

<div align="center">
  <img src="assets/screenshots/showcase-mobile.gif" alt="Immaculaterr mobile UI showcase" width="320" />
</div>

Getting Started (Docker)
---

Use the production Docker stack (app + Caddy) so both HTTP and HTTPS are available:

```bash
mkdir -p /opt/immaculaterr
cd /opt/immaculaterr

curl -fsSL -o docker-compose.dockerhub.yml https://raw.githubusercontent.com/ohmzi/Immaculaterr/master/docker/immaculaterr/docker-compose.dockerhub.yml
curl -fsSL -o caddy-entrypoint.sh https://raw.githubusercontent.com/ohmzi/Immaculaterr/master/docker/immaculaterr/caddy-entrypoint.sh
curl -fsSL -o install-local-ca.sh https://raw.githubusercontent.com/ohmzi/Immaculaterr/master/docker/immaculaterr/install-local-ca.sh
chmod +x caddy-entrypoint.sh install-local-ca.sh

docker rm -f Immaculaterr ImmaculaterrHttps 2>/dev/null || true

IMM_IMAGE=ohmzii/immaculaterr IMM_TAG=latest docker compose -f docker-compose.dockerhub.yml up -d --force-recreate
```

Then open either:

- `http://<server-ip>:5454/`
- `https://<server-ip>:5464/`

Optional (recommended for HTTPS without browser warnings):

```bash
cd /opt/immaculaterr
./install-local-ca.sh
```

If users browse from other devices, import `/tmp/immaculaterr-local-ca.crt` from the Docker host into those devices.

For full setup and update options (including certificate trust), use [`doc/setupguide.md`](setupguide.md).

Platform-specific guides are also available:

- [TrueNAS SCALE](setup-truenas.md) — GUI-only Custom Apps with HTTPS and HTTP-only options.
- [Unraid](setup-unraid.md) — Docker template and compose setup with HTTPS and HTTP-only options.

Development
---

Immaculaterr is a monorepo:

- **API**: NestJS (`apps/api`) — serves the REST API under `/api`
- **Web UI**: React + Vite (`apps/web`)

The development commands below are for the project owner and separately authorized developers. Public visibility of the repository does not grant permission to use, modify, or redistribute the source code.

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

Immaculaterr is distributed under custom terms — see [LICENSE](../LICENSE).

Source code: the public repository does not grant permission to use, copy, modify, redistribute, sublicense, or sell the source code without separate written permission from the copyright holder.

Official Docker images and release artifacts: you may download and run the unmodified official artifacts published by the project owner for personal, noncommercial self-hosting only. Redistribution, resale, derivative images, repackaging, and commercial use are not allowed without separate written permission.

This project uses publicly available APIs and integrates with third‑party services (Plex, Radarr, Sonarr, TMDB, OpenAI, Google).
You are responsible for complying with their respective terms of service. Immaculaterr is not affiliated with or endorsed by those services.
