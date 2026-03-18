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

- **Reacts to Plex activity in real time**
  Watches your Plex library and automatically triggers smart workflows when you watch TV shows or  Movies.

- **Runs scheduled tasks**
  Fetches new content and refreshes your Plex home screen in the background on a schedule, to freshen up your plex home screens.

- **Builds curated movie and TV collections**
  - A long-term collection based on your overall taste (Immaculate Taste)
  - A collection based on what you've watched recently (refreshes after every watch)
  - A "Change of Taste" collection that also refreshes after every watch

- **Supports multiple taste profiles running side by side**
  - Run several Immaculate Taste profiles at once, each with its own download route, folder, and naming settings
  - Naming stays consistent across profiles thanks to per-profile overrides and fallbacks

- **Smarter filtering per profile**
  - Filter by genre and audio language per profile to include or exclude exactly what you want
  - Better matching means fewer unwanted titles and more accurate recommendations

- **TMDB Upcoming Movies task filters**
  - Build custom filter sets with where-to-watch, genre, language, certification, and score controls

- **Personalized rows for every viewer**
  - Each person on your Plex gets their own curated rows (e.g. *Based on your recently watched — Jane*)
  - Viewing history is kept separate, so one person's habits don't affect anyone else's recommendations

- **Pins collections to the right place based on role**
  - Admin rows appear in Library Recommended and Home
  - Shared user rows appear in Friends Home *(current Plex limitation for non-admins)*

- **Powered by multiple recommendation sources**
  Uses TMDB by default, with optional Google and OpenAI support.

- **Remembers what's been recommended**
  Keeps a local database so it can detect when a previously suggested title finally lands in your Plex library.

- **Lets you control which libraries are included**
  - Pick your movie and TV libraries during setup, or adjust anytime from Command Center
  - New libraries are included automatically unless you turn them off
  - If a library is unavailable during a run, that part is skipped cleanly and noted in the report — nothing breaks

- **Smart refresh scoping**
  - When a collection triggers a refresh, it stays focused on that viewer and library
  - Scheduled or manual full runs process all eligible users and libraries in a consistent order, with the admin handled last

- **Sends content directly to Radarr and Sonarr**
  When Seerr is off, missing titles go straight to your download apps.

- **Observatory — approve and manage suggestions**
  - Swipe to approve download requests *(optional approval mode)*
  - Swipe left to reject a suggestion and stop it from appearing again — reset your rejected list anytime from Command Center

- **Custom posters for your collections**
  - Upload your own poster for any collection Immaculaterr creates
  - Preview and upload from Command Center — posters are saved and survive app restarts and updates

- **Optional Seerr routing**
  - Send missing content requests through Seerr instead of directly to your download apps
  - Toggle it per task, so different tasks can use different flows
  - Clear all Seerr requests at once from Command Center when needed

- **Detailed job reports and logs**
  Step-by-step breakdown of every run, with metrics and full history.

- **Full visibility and control**
  Manage users, datasets, and resets from Command Center. Clear reporting shows exactly what ran, what was skipped, and why.

- **Coming soon**
  - Discovering content from film industries around the world
  - Email reports on your media server's health
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
Option A (DockerHub):
```bash
docker pull ohmzii/immaculaterr:latest
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
  ohmzii/immaculaterr:latest
```

Option B (GHCR):
```bash
docker pull ghcr.io/ohmzi/immaculaterr:latest
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
  ohmzii/immaculaterr:latest
```

#### Optional HTTPS sidecar (can run anytime later)

restart the browser after running the following command. 

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
- Report Bug or issues: [GitHub Report Bug](https://github.com/ohmzi/Immaculaterr/issues)
- After V1.7 i'll be taking break from working on new features, and only do security patches and if needed bug fixes. I shall resume working on new feature in couple months.
- Send Suggestion: [GitHub Feature Request](https://github.com/ohmzi/Immaculaterr/issues)
##

## License
Immaculaterr is licensed under the **MIT License** — see [`LICENSE`](LICENSE).
