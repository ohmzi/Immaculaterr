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
</div>


## What it does

- **Watches Plex activity and reacts automatically**
  - Finish a movie or episode, and Immaculaterr can turn that watch into fresh collections and great new recommendations right away.
  - It builds rows around what you actually watch and pins them where Plex can surface them, so your home screen feels more curated and personal, a bit like your own Netflix.
  - Off-peak schedules keep those rows fresh with background refresh, discovery, cleanup, and maintenance.

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
  - Observatory can hold items for swipe approval before they are sent.

- **Includes discovery and maintenance jobs**
  - `Fresh Out Of The Oven` builds recent-release movie and TV rows for titles a user has not watched yet.
  - `TMDB Upcoming Movies` finds upcoming movies with filter sets and routes matches to Radarr or Seerr.
  - `Rotten Tomatoes Upcoming Movies` scrapes fixed Rotten Tomatoes pages and routes safe matches to Radarr or Seerr.
  - Cleanup and ARR sync jobs help keep Plex, Radarr, and Sonarr tidy after imports and downloads.

- **Supports history imports from day one**
  - Netflix CSV import creates dedicated Netflix import collections and feeds the main recommendation system.
  - Plex watch-history import does the same without needing a CSV.

- **Supports custom posters for managed collections**
  - Upload and manage poster overrides in Command Center.
  - Posters are stored so they survive restarts and updates.

- **Keeps a shared queue and clear run history**
  - Manual runs, schedules, Plex webhooks, and Plex polling all go through one persisted FIFO queue.
  - Rewind shows queued work, live progress, reports, logs, and run history.

- **Includes built-in admin sign-in and recovery**
  - Create the admin login during setup.
  - Password recovery uses security questions.

- **Puts management in the app**
  - Use Vault for integrations, Task Manager for jobs, Rewind for reports, and Command Center for resets, posters, user monitoring, and request cleanup.

- **Coming soon**
  - Email reports on your media server's health
  - Windows and macOS support

## How recommendations are built

1. A watch event, manual run, or history import supplies a seed title, and the app builds a richer seed profile from it.
2. TMDB pulls fuller metadata and candidate pools, including standard picks plus wildcard lanes for global-language films and hidden gems.
3. A multi-factor ranking engine scores candidates using similarity, quality, novelty, and indie/popularity signals.
4. Ranking weights change by intent, so latest-watched and change-of-taste runs do not rank titles the same way, and released vs. upcoming mixes can be tuned separately.
5. Final picks are interleaved so core recommendations stay strong while wildcard discoveries add variety.


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

Official Docker images and release artifacts are the supported public distribution channel for end users.

### Installation 

#### HTTPS installation which includes sidecar
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
  -e TRUST_PROXY=1 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  "$IMM_IMAGE"
```

#### HTTP only installation

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
  -e TRUST_PROXY=1 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  "$IMM_IMAGE"
```
## 

## Access after installation
- HTTPS port (available only if you ran the HTTPS installation guide):
  - `https://localhost:5464/`
  - `https://<server-ip>:5464/`
  
- HTTP port:
  - `http://localhost:5454/`
  - `http://<server-ip>:5454/`

- Available ports:
  - `5454/tcp`: Immaculaterr HTTP
  - `5464/tcp`: Immaculaterr HTTPS sidecar (optional)
##

For install and update commands, use the setup guide: [`doc/setupguide.md`](doc/setupguide.md).
For local HTTPS, run [`docker/immaculaterr/install-local-ca.sh`](docker/immaculaterr/install-local-ca.sh) on the Docker host (recommended), or accept your browser's risk warning when prompted (you may need to re-accept in later browser sessions).
##

## Development

The source repository remains public for transparency and review. The development commands in the linked docs are for the project owner and separately authorized developers; they do not grant permission to use, modify, or redistribute the source code.

## Documentation
- Setup guide: [`doc/setupguide.md`](doc/setupguide.md)
- FAQ: [`doc/FAQ.md`](doc/FAQ.md)
- Security policy: [`doc/security.md`](doc/security.md)
- Version history: [`doc/Version_History.md`](doc/Version_History.md)

Full project README: [`doc/README.md`](doc/README.md)
##

## Contributing
Thanks for wanting to help improve Immaculaterr.

The public repository is available so people can inspect and validate the source code. Immaculaterr is not open source, so code contributions, pull requests, and external patches are not accepted or encouraged.

If you want to help:
- Report bugs: [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues)
- Suggest features or improvements: [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues)
- Report security issues: see [`doc/security.md`](doc/security.md), or use GitHub Issues if needed
##

## License
Immaculaterr is distributed under custom terms — see [`LICENSE`](LICENSE).

Source code: the public repository does not grant permission to use, copy, modify, redistribute, sublicense, or sell the source code without separate written permission from the copyright holder.

Official Docker images and release artifacts: you may download and run the unmodified official artifacts published by the project owner for personal, noncommercial self-hosting only. Redistribution, resale, derivative images, repackaging, and commercial use are not allowed without separate written permission.
