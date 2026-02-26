<div align="center">
  <img src="doc/assets/readme-header.png" alt="Immaculaterr banner" width="100%" />
</div>

<div align="center">
  <p>
    A Plex “autopilot” that watches what you’re watching, builds curated collections, and keeps your library tidy — without the babysitting.
  </p>

  <p>
    <a href="https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-containers.yml">
      <img alt="Publish containers (GHCR + Docker Hub)" src="https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-containers.yml/badge.svg?branch=master" />
    </a>
    <a href="https://github.com/ohmzi/Immaculaterr/releases">
      <img alt="Latest Release" src="https://img.shields.io/github/v/release/ohmzi/Immaculaterr" />
    </a>
    <a href="./LICENSE">
      <img alt="License" src="https://img.shields.io/badge/license-MIT-brightgreen" />
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
</div>

## What it does

- **Plex-triggered automation**:
  - Automatically reacts to Plex library activity and runs smart workflows in real time.
- **Scheduler automation**:
  - Handles off-hours fetching and Plex home refresh workflows.
- **Curated Movies and TV Shows collections**:
  - Inspired by your Immaculate Taste (long-term collection)
  - Based on your recently watched (refreshes on every watch)
  - Change of Taste (refreshes on every watch)
- **Per-viewer personalization (Movies + TV)**:
  - Each Plex viewer gets their own curated rows (for example: `Based on your recently watched show (userName)`).
  - Recommendation datasets are isolated per viewer and per library, so one viewer’s history does not influence another viewer’s rows.
- **Role-based Plex pinning**:
  - Admin viewer rows are pinned to **Library Recommended** and **Home**.
  - Non-admin viewer rows are pinned to **Friends Home** (current Plex workflow limitation for shared users).
- **Recommendation engine**:
  - TMDB-powered suggestions
  - Optional: Google + OpenAI
- **Keeps a snapshot database:**
  - Stores recommendation data so refresher jobs can detect when pending titles become available in Plex.
- **Plex library selection guardrails**:
  - Choose which movie/show libraries are included during onboarding and later from **Command Center → Plex Library Selection**.
  - New Plex movie/show libraries are included automatically unless you turn them off.
  - If a run targets a turned-off or temporarily unavailable library, that part is skipped safely and shown clearly in the run report instead of failing the whole job.
- **Refresher scoping behavior**:
  - Collection-triggered/chained refresh stays scoped to the triggering viewer/library.
  - Standalone refresher runs (scheduled or manual without scope) sweep eligible users/libraries in deterministic order, with admin processed last.
- **Radarr + Sonarr integration**:
  - Sends movies/series directly to ARR downloaders when Overseerr mode is off.
- **Observatory**:
  - Swipe to approve download requests (optional “approval required” mode), curate suggestions.
  - Swipe left adds a suggestion to your rejected list (it won’t be suggested again). You can clear this via **Command Center → Reset Rejected List**.
- **Overseerr integration (optional centralized request flow)**:
  - Route missing movie/TV requests to Overseerr instead of direct ARR sends.
  - Enable it per task card, so each task can use its own missing-item flow.
  - Includes a Command Center reset control to clear all Overseerr requests when needed.
- **Job reports & logs**:
  - Step-by-step breakdowns, metrics tables, and run history.
- **Operational visibility and controls**:
  - User-aware Command Center reset controls, Plex-user dataset management, expanded debugger coverage, and clearer user/media run reporting.
- **More features on the way**:
  - Discovering Media from film industries around the world
  - Email reports on media server health
  - Windows and macOS support

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
  <br/>
  <br/>
</div>

## Getting started (Docker)

### Installation 

#### HTTP-only update (required)
```bash
docker pull ohmzii/immaculaterr:v1.6.0

docker rm -f Immaculaterr 2>/dev/null || true

docker run -d \
  --name Immaculaterr \
  --network host \
  -e HOST=0.0.0.0 \
  -e PORT=5454 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  ohmzii/immaculaterr:v1.6.0
```

#### Optional HTTPS sidecar (can run anytime later)
```bash
mkdir -p ~/immaculaterr
curl -fsSL -o ~/immaculaterr/caddy-entrypoint.sh \
  "https://raw.githubusercontent.com/ohmzi/Immaculaterr/v1.6.0/docker/immaculaterr/caddy-entrypoint.sh"
chmod +x ~/immaculaterr/caddy-entrypoint.sh

docker pull caddy:2.8.4-alpine
docker rm -f ImmaculaterrHttps 2>/dev/null || true

docker run -d \
  --name ImmaculaterrHttps \
  --network host \
  -e IMM_ENABLE_HTTP=false \
  -e IMM_ENABLE_HTTPS=true \
  -e IMM_HTTPS_PORT=5464 \
  -e IMM_INCLUDE_LOCALHOST=true \
  -e IMM_ENABLE_LAN_IP=true \
  -e APP_INTERNAL_PORT=5454 \
  -v ~/immaculaterr/caddy-entrypoint.sh:/etc/caddy/caddy-entrypoint.sh:ro \
  -v immaculaterr-caddy-data:/data \
  -v immaculaterr-caddy-config:/config \
  --restart unless-stopped \
  caddy:2.8.4-alpine \
  /bin/sh /etc/caddy/caddy-entrypoint.sh
```
## 

## Access after installation
- HTTP app (available after the required install step):
  - `http://localhost:5454/`
  - `http://<server-ip>:5454/`
- HTTPS sidecar (available only if you ran the optional HTTPS command):
  - `https://localhost:5464/`
  - `https://<server-ip>:5464/`
- Available ports:
  - `5454/tcp`: Immaculaterr HTTP
  - `5464/tcp`: Immaculaterr HTTPS sidecar (optional)
##

For install and update commands, use the setup guide: [`doc/setupguide.md`](doc/setupguide.md).
For local HTTPS, run [`docker/immaculaterr/install-local-ca.sh`](docker/immaculaterr/install-local-ca.sh) on the Docker host (recommended), or accept your browser's risk warning when prompted (you may need to re-accept in later browser sessions).
##

## Documentation
- Setup guide: [`doc/setupguide.md`](doc/setupguide.md)
- FAQ: [`doc/FAQ.md`](doc/FAQ.md)
- Security policy: [`doc/security.md`](doc/security.md)
- Version history: [`doc/Version_History.md`](doc/Version_History.md)

Full project README: [`doc/README.md`](doc/README.md)
##

## Security and Suggestions
- Report Bug: [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues)
- Send Suggestion: [Immaculaterr Feedback Form](https://forms.gle/wMpsDu9jPEY14dua6)
##

## License
Immaculaterr is licensed under the **MIT License** — see [`LICENSE`](LICENSE).
