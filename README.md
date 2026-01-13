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
  - Windows and macOS support
<div align="center">
  <p><b>Desktop UI</b></p>
  <img src="doc/assets/screenshots/showcase.gif" alt="Immaculaterr desktop UI showcase" width="900" />
  <br/>
  <br/>
  <p><b>Mobile UI (full mobile support)</b></p>
  <img src="doc/assets/screenshots/showcase-mobile.gif" alt="Immaculaterr mobile UI showcase" width="320" />
</div>

## Getting started (Docker)

### Install from the package

**Option A (Docker Hub — best for Portainer search/discovery):**

```bash
docker pull ohmzii/immaculaterr:latest

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

**Option B (GHCR):**

```bash
docker pull ghcr.io/ohmzi/immaculaterr:latest
```

See the setup guide for extended instructions: [`doc/setupguide.md`](doc/setupguide.md)

Then open `http://<server-ip>:5454/` and configure integrations in the UI (Plex/Radarr/Sonarr/TMDB/OpenAI/Google as desired).

## Documentation

- Setup guide: [`doc/setupguide.md`](doc/setupguide.md)
- FAQ: [`doc/FAQ.md`](doc/FAQ.md)
- Security policy: [`doc/security.md`](doc/security.md)
- Version history: [`doc/Version_History.md`](doc/Version_History.md)

Full project README: [`doc/README.md`](doc/README.md)

## Security and Suggestions

- Report Bug: [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues)
- Send Suggestion: [Immaculaterr Feedback Form](https://forms.gle/wMpsDu9jPEY14dua6)

## ❤️ Support

This project is free and always will be.

If it saves you time or runs 24/7 in your homelab, consider supporting development via GitHub Sponsors:
[https://github.com/sponsors/ohmzi](https://github.com/sponsors/ohmzi)

## License

Immaculaterr is licensed under the **MIT License** — see [`LICENSE`](LICENSE).

