<div align="center">
  <img src="doc/assets/readme-header.png" alt="Immaculaterr banner" width="100%" />
</div>

<div align="center">
  <p>
    <b>A Plex “autopilot” that watches what you’re watching, builds curated collections, and keeps your library tidy — without the babysitting.</b>
  </p>

  <p>
    <a href="https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-containers.yml">
      <img alt="Publish containers (GHCR + Docker Hub)" src="https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-containers.yml/badge.svg?branch=master" />
    </a>
    <a href="https://github.com/ohmzi/Immaculaterr/releases">
      <img alt="Latest Release" src="https://img.shields.io/github/v/release/ohmzi/Immaculaterr" />
    </a>
    <a href="./LICENSE">
      <img alt="License" src="https://img.shields.io/badge/license-custom%20terms-blue" />
    </a>
    <a href="https://github.com/ohmzi/Immaculaterr/pkgs/container/immaculaterr">
      <img
        alt="GHCR Downloads"
        src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ohmzi/Immaculaterr/develop/doc/assets/badges/ghcr-package-downloads.json&cacheSeconds=300"
      />
    </a>
    <a href="https://hub.docker.com/r/ohmzii/immaculaterr">
      <img
        alt="Docker Pulls"
        src="https://img.shields.io/docker/pulls/ohmzii/immaculaterr"
      />
    </a>
  </p>

  <p>
    <a href="#-quick-start">Quick start</a> ·
    <a href="#-what-it-does">Features</a> ·
    <a href="doc/setupguide.md">Setup guide</a> ·
    <a href="doc/FAQ.md">FAQ</a> ·
    <a href="https://github.com/ohmzi/Immaculaterr/issues">Issues</a>
  </p>
</div>

---

## 📖 Table of contents

- [Why Immaculaterr](#-why-immaculaterr)
- [Quick start](#-quick-start)
- [What it does](#-what-it-does)
- [How recommendations are built](#-how-recommendations-are-built)
- [Screenshots](#-screenshots)
- [Tech stack](#-tech-stack)
- [Installation](#-installation)
  - [HTTPS installation (includes sidecar)](#https-installation-which-includes-sidecar)
  - [HTTP only installation](#http-only-installation)
- [Access after installation](#-access-after-installation)
- [Hosting under a subpath](#-hosting-under-a-subpath-such-as-recommendations)
- [Integrations](#-integrations)
- [Project structure](#-project-structure)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🎯 Why Immaculaterr

| | |
| --- | --- |
| 🍿 **Reacts to what you watch** | Finish a movie or episode and fresh, personal collections appear on your Plex home screen. |
| 👥 **Personal per viewer** | Every monitored Plex user gets their own rows and their own watch history. |
| 🎛️ **You stay in control** | Observatory lets you swipe through suggestions before anything reaches Plex or your ARRs. |
| 🧹 **Keeps the library tidy** | Cutting Room finds and prunes media nobody will ever watch — with a dry run and one-click restore. |
| 📦 **One container** | Docker image, persisted queue, run history, and an optional HTTPS sidecar. |

---

## ⚡ Quick start

```bash
docker run -d \
  --name Immaculaterr \
  -p 5454:5454 \
  -e HOST=0.0.0.0 \
  -e PORT=5454 \
  -e TZ=America/New_York \
  -e TRUST_PROXY=1 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  ghcr.io/ohmzi/immaculaterr:latest
```

Then open `http://<server-ip>:5454/` and follow the setup wizard. For HTTPS, updates, and platform-specific guides, see [Installation](#-installation).

---

## ✨ What it does

- **Watches Plex activity and reacts automatically**
  - Finish a movie or episode, and Immaculaterr can turn that watch into fresh collections and great new recommendations right away.
  - It builds rows around what you actually watch and pins them on home screen, making your home screen feels more curated and personal, a bit like your own Netflix.
  - Off-peak schedules keep those rows fresh with background refresh, discovery, cleanup, and maintenance.
  - Bingeing does not spam you: once a show has triggered an auto-run, later episodes of that same show are skipped rather than rebuilding the same collections again — and the skip is recorded so you can see why.

- **Creates managed Plex collections**
  - `Based on your recently watched Movie` and `Based on your recently watched Show`
  - `Change of Movie Taste` and `Change of Show Taste`
  - `Inspired by your Immaculate Taste in Movies` and `Inspired by your Immaculate Taste in Shows`
  - `Fresh Out Of The Oven` and `Fresh Out Of The Oven Show`
  - `Netflix Import Picks` and `Netflix Import: Change of Taste`
  - `Plex History Picks` and `Plex History: Change of Taste`
  - Immaculate Taste profiles can also create extra custom-named collections.

- **Lets you split Immaculate Taste into multiple profiles**
  - Give each profile its own users, media type, filters, collection names, and download route.
  - Use genre and audio-language filters to build focused lanes like animation, family, or specific-language picks.

- **Keeps recommendations personal for each Plex user**
  - Each monitored viewer gets separate rows and separate watch history.
  - Managed rows are pinned to the Plex surfaces that viewer can actually see.

- **Uses a flexible recommendation engine**
  - TMDB is the main source.
  - Google and OpenAI are optional helpers for widening or refining results.
  - You can tune the mix between titles available now and future releases.

- **Sends missing titles where you want them**
  - Send directly to Radarr and Sonarr, or route through Seerr on a per-task basis.
  - Turn on `Approval required from Observatory` and nothing is sent until you have said yes to it yourself.

- **Observatory: swipe through suggestions before they reach Plex**
  - A card deck for judging recommendations one title at a time, with the poster, the rating, and its score in front of you before you decide.
  - Two passes per library. First the approvals: swipe right to **approve** a missing title for Radarr/Sonarr, left to **reject** it. Then the review pass: swipe right to **keep** a title in the collection, left to **remove** it.
  - Swipe on a phone, drag on a desktop, or use the buttons — arrow keys work too, and `Z` undoes the last card when you change your mind.
  - Decisions are saved as you make them rather than piling up behind a Save button, and the deck tells you how many cards are left.
  - Separate decks for `Immaculate Taste` and `Based on Latest Watched`, each split by library and by movies vs. shows, so the two never get tangled.
  - The sync to Plex runs in the background, so a big library finishes on its own time instead of stalling the page.

- **Includes discovery and maintenance jobs**
  - `Fresh Out Of The Oven` builds recent-release movie and TV rows for titles a user has not watched yet.
  - `TMDB Upcoming Movies` finds upcoming movies with filter sets and routes matches to Radarr or Seerr.
  - `Rotten Tomatoes Upcoming Movies + TV Shows` scrapes fixed Rotten Tomatoes movie and TV pages, uses saved Movies and TV toggles with separate Movie Top 20 and TV Top 10 counts, and lets Run Now use those saved settings directly.
  - Cleanup and ARR sync jobs help keep Plex, Radarr, and Sonarr tidy after imports and downloads, including season-aware Sonarr monitoring cleanup.
  - `Confirm Monitored` only unmonitors a movie once Plex can actually play it *and* Radarr confirms the file is there, so a missing or half-finished download is never mistaken for a finished one.

- **Cutting Room: prunes the media nobody will ever watch**
  - Scans your selected Plex libraries plus Radarr/Sonarr (and Tautulli when connected) and scores every item on real watch history, time in library, ratings with vote confidence (popular and highly-regarded titles are never counted as "low rated"), and who requested it.
  - A six-step wizard: pick factors and protections, choose libraries, scan once, tune "how low a bar" instantly, set a space target with auto-select, review every candidate with plain-language reason chips, then prune with a typed confirmation.
  - Pruning deletes files through Radarr/Sonarr but keeps each entry unmonitored and tagged `deleted-by-immaculaterr`; Pruned History offers one-click Restore that re-monitors and re-downloads.
  - Watchlists, continue-watching, recent requests, your own high-rated titles, and Immaculaterr's managed collections are always protected; a full dry-run mode rehearses everything without touching a file.
  - Companion tabs: a Wanted List cleaner (unmonitor never-downloaded entries without touching files), a Duplicates cleaner (keep one version per movie), and a Large Files replacer (delete oversized movie/episode files, re-monitor exactly the affected items, tag them `size-reduction`, switch them to auto-created size-capped quality profiles — movies ~10 GB max, episodes 3 GB max preferring 1–2 GB — and re-search for smaller copies automatically) — also available as an exclusive "Oversized files" card inside the wizard.

- **Supports history imports from day one**
  - Netflix CSV import creates dedicated Netflix import collections and feeds the main recommendation system.
  - Plex watch-history import does the same without needing a CSV.

- **Supports custom posters for managed collections**
  - Upload and manage poster overrides in Command Center.
  - Posters are stored so they survive restarts and updates.

- **Keeps a shared queue and clear run history**
  - Manual runs, schedules, Plex webhooks, and Plex polling all go through one persisted FIFO queue.
  - Rewind shows queued work, live progress, reports, logs, and run history.
  - Pause the whole queue when you want the server left alone, cancel anything still waiting, and resume when you are ready.
  - Runs fail loudly and honestly: a failed scrape, an unreachable Radarr/Sonarr, or a run where every item failed is reported as a failure with readable diagnostics, instead of quietly reporting zero.
  - Logs have a live tail you can pause, a refresh rate you can set, per-line copy, and a download button.

- **Includes built-in admin sign-in and recovery**
  - Create the admin login during setup.
  - Password recovery uses security questions.

- **Connects to the rest of your stack**
  - Required: Plex. For fetching what is missing: Radarr, Sonarr, or Seerr.
  - For metadata and discovery: TMDB, with Google and OpenAI as optional helpers.
  - Optional: Tautulli, which gives Cutting Room richer watch history than Plex alone. It has its own step in the setup wizard and a testable card in the Vault — and everything still works without it.

- **Feels quick to live in**
  - Search with `Ctrl/Cmd+K` (or `/`) to jump to any page, and it finds FAQ answers too.
  - Filters and tabs are remembered between visits, so you come back to where you left off.
  - Times read as "4 days ago", with the exact timestamp on hover.
  - Full mobile support, including pull-to-refresh on Rewind and Logs — and if you prefer less movement, reduced-motion is respected throughout.
  - Pages load as you visit them instead of as one large bundle, so the first screen arrives quickly.

- **Puts management in the app**
  - Use Vault for integrations, Task Manager for jobs, Rewind for reports, and Command Center for resets, posters, user monitoring, and request cleanup.

---

## 🧠 How recommendations are built

1. A watch event, manual run, or history import supplies a seed title, and the app builds a richer seed profile from it.
2. TMDB pulls fuller metadata and candidate pools, including standard picks plus wildcard lanes for global-language films and hidden gems.
3. A multi-factor ranking engine scores candidates using similarity, quality, novelty, and indie/popularity signals.
4. Ranking weights change by intent, so latest-watched and change-of-taste runs do not rank titles the same way, and released vs. upcoming mixes can be tuned separately.
5. Final picks are interleaved so core recommendations stay strong while wildcard discoveries add variety.

---

## 📸 Screenshots

<div align="center">
  <p><b>Desktop UI</b></p>
  <img src="https://github.com/ohmzi/Immaculaterr/blob/master/doc/assets/screenshots/showcase.gif" alt="Immaculaterr desktop UI showcase" width="900" />
  <br/>
  <p><b>Mobile UI (full mobile support)</b></p>
  <img src="https://github.com/ohmzi/Immaculaterr/blob/master/doc/assets/screenshots/showcase-mobile.gif" alt="Immaculaterr mobile UI showcase" width="320" />
  <br/>
  <br/>
  <p><b>Plex UI examples</b></p>
  <img src="https://github.com/ohmzi/Immaculaterr/blob/master/doc/assets/screenshots/plex_mobile_app_screenshot2.png" alt="Plex mobile screenshot showing Immaculaterr recommendations" width="320" />
  <br/>
  <img src="https://github.com/ohmzi/Immaculaterr/blob/master/doc/assets/screenshots/plex_pc_screenshot.png" alt="Plex desktop screenshot showing Immaculaterr recommendations" width="900" />
</div>

---

## 🧰 Tech stack

<div align="center">

**Backend**

<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
<img alt="Node.js" src="https://img.shields.io/badge/Node.js%2020+-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white" />
<img alt="NestJS" src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" />
<img alt="Prisma" src="https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white" />
<img alt="SQLite" src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" />
<img alt="Swagger" src="https://img.shields.io/badge/OpenAPI-6BA539?style=for-the-badge&logo=swagger&logoColor=white" />

**Frontend**

<img alt="React" src="https://img.shields.io/badge/React%2019-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
<img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
<img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind%20CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" />
<img alt="Radix UI" src="https://img.shields.io/badge/Radix%20UI-161618?style=for-the-badge&logo=radixui&logoColor=white" />
<img alt="TanStack Query" src="https://img.shields.io/badge/TanStack%20Query-FF4154?style=for-the-badge&logo=reactquery&logoColor=white" />
<img alt="React Router" src="https://img.shields.io/badge/React%20Router-CA4245?style=for-the-badge&logo=reactrouter&logoColor=white" />

**Delivery & quality**

<img alt="Docker" src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
<img alt="Caddy" src="https://img.shields.io/badge/Caddy-1F88C0?style=for-the-badge&logo=caddy&logoColor=white" />
<img alt="GitHub Actions" src="https://img.shields.io/badge/GitHub%20Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white" />
<img alt="Jest" src="https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white" />
<img alt="Cypress" src="https://img.shields.io/badge/Cypress-69D3A7?style=for-the-badge&logo=cypress&logoColor=black" />

</div>

---

## 🚀 Installation

Official Docker images and release artifacts are the supported public distribution channel for end users.

### HTTPS installation which includes sidecar

(restart your browser after installation)

```bash
IMM_IMAGE="ghcr.io/ohmzi/immaculaterr:latest"

docker pull "$IMM_IMAGE"
docker pull caddy:2.8.4-alpine
docker rm -f ImmaculaterrHttps 2>/dev/null || true
docker rm -f Immaculaterr 2>/dev/null || true

docker volume create immaculaterr-caddy-data >/dev/null 2>&1 || true
docker volume create immaculaterr-caddy-config >/dev/null 2>&1 || true

docker run -d \
  --name ImmaculaterrHttps \
  --network host \
  -e IMM_ENABLE_HTTP=false \
  -e IMM_ENABLE_HTTPS=true \
  -e IMM_HTTPS_PORT=5464 \
  -e IMM_INCLUDE_LOCALHOST=true \
  -e IMM_ENABLE_LAN_IP=true \
  -e APP_INTERNAL_PORT=5454 \
  -v "$HOME/immaculaterr/caddy-entrypoint.sh:/etc/caddy/caddy-entrypoint.sh:ro" \
  -v immaculaterr-caddy-data:/data \
  -v immaculaterr-caddy-config:/config \
  --restart unless-stopped \
  caddy:2.8.4-alpine \
  /bin/sh /etc/caddy/caddy-entrypoint.sh

docker run -d \
  --name Immaculaterr \
  -p 5454:5454 \
  -e HOST=0.0.0.0 \
  -e PORT=5454 \
  -e TZ=America/New_York \
  -e TRUST_PROXY=1 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  "$IMM_IMAGE"
```

### HTTP only installation

```bash
IMM_IMAGE="ghcr.io/ohmzi/immaculaterr:latest"

docker pull "$IMM_IMAGE"
docker rm -f ImmaculaterrHttps 2>/dev/null || true
docker rm -f Immaculaterr 2>/dev/null || true

docker run -d \
  --name Immaculaterr \
  -p 5454:5454 \
  -e HOST=0.0.0.0 \
  -e PORT=5454 \
  -e TZ=America/New_York \
  -e TRUST_PROXY=1 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  "$IMM_IMAGE"
```

> [!NOTE]
> The examples above set the app container timezone to `America/New_York`. Change the `TZ` value if you prefer a different IANA timezone.
>
> For install and update commands, use the setup guide: [`doc/setupguide.md`](doc/setupguide.md).
>
> For local HTTPS, run [`docker/immaculaterr/install-local-ca.sh`](docker/immaculaterr/install-local-ca.sh) on the Docker host (recommended), or accept your browser's risk warning when prompted (you may need to re-accept in later browser sessions).

---

## 🌐 Access after installation

| Port | Purpose | URLs |
| --- | --- | --- |
| `5454/tcp` | Immaculaterr HTTP | `http://localhost:5454/` · `http://<server-ip>:5454/` |
| `5464/tcp` | Immaculaterr HTTPS sidecar (optional) | `https://localhost:5464/` · `https://<server-ip>:5464/` |

The HTTPS port is available only if you ran the HTTPS installation guide.

---

## 🧭 Hosting under a subpath such as `/recommendations`

`APP_BASE_PATH` is only the public path prefix for Immaculaterr. Do not put a full URL, domain, protocol, or port in this value.

If the app is served at the site root, leave `APP_BASE_PATH` unset. Set `APP_BASE_PATH=/recommendations` and keep `TRUST_PROXY=1` only when a reverse proxy or tunnel serves Immaculaterr from that subpath.

Example `.env` or compose overrides:

```env
APP_BASE_PATH=/recommendations
TRUST_PROXY=1
```

After that, open:

- `http://<server-ip>:5454/recommendations/`
- `https://<server-ip>:5464/recommendations/`

In the app, use `Setup` for the in-app hosting walkthrough, then open `Profile` to confirm the active `App base path` value. Root deployments should show `/`. Subpath deployments should show the exact configured prefix.

Example nginx reverse proxy:

```nginx
location = /recommendations {
  return 301 /recommendations/;
}

location /recommendations/ {
  proxy_pass http://127.0.0.1:5454;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Port $server_port;
}
```

---

## 🔌 Integrations

| Service | Required | What it is used for |
| --- | :---: | --- |
| **Plex** | ✅ | The library Immaculaterr reads, builds collections in, and pins rows on. |
| **TMDB** | ✅ | Primary metadata and candidate source for recommendations. |
| **Radarr** | ➖ | Fetching missing movies. |
| **Sonarr** | ➖ | Fetching missing shows. |
| **Seerr** | ➖ | Alternative, centralized request route instead of direct ARR sends. |
| **Tautulli** | ⬜ | Richer watch history for Cutting Room than Plex alone. Everything still works without it. |
| **OpenAI** | ⬜ | Optional helper for widening or refining recommendation results. |
| **Google** | ⬜ | Optional helper for widening or refining recommendation results. |

✅ required · ➖ at least one needed to fetch missing titles · ⬜ fully optional

---

## 📁 Project structure

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

---

## 📚 Documentation

| Guide | Description |
| --- | --- |
| [`doc/setupguide.md`](doc/setupguide.md) | Install, configure, and update Immaculaterr. |
| [`doc/setup-unraid.md`](doc/setup-unraid.md) | Unraid-specific installation. |
| [`doc/setup-truenas.md`](doc/setup-truenas.md) | TrueNAS-specific installation. |
| [`doc/setup-updating.md`](doc/setup-updating.md) | Updating an existing installation. |
| [`doc/FAQ.md`](doc/FAQ.md) | Frequently asked questions. |
| [`doc/security.md`](doc/security.md) | Security policy and how to report issues. |
| [`doc/Version_History.md`](doc/Version_History.md) | Notable changes by version. |
| [`doc/README.md`](doc/README.md) | Full project README. |

---

## 🤝 Contributing

Thanks for wanting to help improve Immaculaterr.

The public repository is available so people can inspect and validate the source code. Immaculaterr is not open source, so code contributions, pull requests, and external patches are not accepted or encouraged.

If you want to help:

- 🐞 Report bugs: [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues)
- 💡 Suggest features or improvements: [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues)
- 🔒 Report security issues: see [`doc/security.md`](doc/security.md), or use GitHub Issues if needed

---

## 📄 License

Immaculaterr is distributed under custom terms — see [`LICENSE`](LICENSE).

**Source code:** the public repository does not grant permission to use, copy, modify, redistribute, sublicense, or sell the source code without separate written permission from the copyright holder.

**Official Docker images and release artifacts:** you may download and run the unmodified official artifacts published by the project owner for personal, noncommercial self-hosting only. Redistribution, resale, derivative images, repackaging, and commercial use are not allowed without separate written permission.

<div align="center">
  <br/>
  <sub>Built for people who would rather watch something than manage a library.</sub>
</div>
