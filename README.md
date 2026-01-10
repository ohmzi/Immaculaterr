<div align="center">
  <img src="doc/assets/readme-header.jpg" alt="Immaculaterr banner" width="100%" />
</div>

<div align="center">
  <h1>Immaculaterr</h1>
  <p>
    A Plex “autopilot” that watches what you’re watching, generates curated collections, and keeps your library tidy.
  </p>

  <p>
    <a href="https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-ghcr.yml">
      <img alt="Build Status" src="https://github.com/ohmzi/Immaculaterr/actions/workflows/publish-ghcr.yml/badge.svg" />
    </a>
    <a href="https://github.com/ohmzi/Immaculaterr/releases">
      <img alt="Latest Release" src="https://img.shields.io/github/v/release/ohmzi/Immaculaterr" />
    </a>
    <a href="./LICENSE">
      <img alt="License" src="https://img.shields.io/github/license/ohmzi/Immaculaterr" />
    </a>
    <a href="https://github.com/ohmzi/Immaculaterr/releases">
      <img alt="GitHub Downloads" src="https://img.shields.io/github/downloads/ohmzi/Immaculaterr/total" />
    </a>
  </p>
</div>

## What it does

- **Plex-triggered automation (no webhook setup required)**: detects “finished watching” via Plex polling, then runs tasks automatically.
- **Curated collections you actually want to open**:
  - Inspired by your Immaculate Taste (Movies + TV)
  - Based on your recently watched movie/show
  - Change of Taste
- **Poster artwork included**: collections use the matching posters shipped in `apps/web/src/assets/collection_artwork/posters`.
- **Recommendation engine**:
  - TMDB-powered “similar” suggestions
  - Optional Google + OpenAI enrichment (still shows “not enabled” / “skipped” when off)
- **Keeps a snapshot database** for watched-based collections (active/pending) so refreshers can activate titles once they arrive in Plex.
- **Radarr + Sonarr integration** (optional per job): “Fetch Missing items” toggles let you decide whether jobs can send titles to ARR downloaders.
- **Job reports & logs**: step-by-step breakdowns, metrics tables, expandable lists, and run history.

## Getting started (Docker)

Immaculaterr is designed to run as a single container.

```bash
docker compose -f docker/immaculaterr/docker-compose.yml pull
docker compose -f docker/immaculaterr/docker-compose.yml up -d
```

Then open `http://<server-ip>:3210/` and configure integrations in the UI (Plex/Radarr/Sonarr/TMDB/OpenAI/Google as desired).

## Documentation

- Setup guide: [`doc/setupguide.md`](doc/setupguide.md)
- FAQ: [`doc/FAQ.md`](doc/FAQ.md)
- Security policy: [`doc/security.md`](doc/security.md)
- Version history: [`doc/Version_History.md`](doc/Version_History.md)

Full project README: [`doc/README.md`](doc/README.md)

## Support

- Report Bug: [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues)
- Send Suggestion: [Immaculaterr Feedback Form](https://forms.gle/wMpsDu9jPEY14dua6)

## License

Immaculaterr is licensed under the **MIT License** — see [`LICENSE`](LICENSE).

