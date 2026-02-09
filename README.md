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
  - Swipe left adds a suggestion to your rejected list (it won’t be suggested again). You can clear this via **Command Center → Reset Rejected List**.
- **Job reports & logs**:
  - Step-by-step breakdowns, metrics tables, and run history.
- **More features on the way:**
  - Discovering Media from film industries around the world
  - Email reports on media server health
  - Windows and macOS support

## What changed in this branch (vs `develop`)

This branch (PR #103) adds a **per-viewer collection model** so recommendations are built and managed independently per Plex viewer.

- **Independent collections per viewer (Movies + TV)**:
  - Each viewer now gets their own curated collection rows, with the viewer suffix in the title (example: `Based on your recently watched show (ohmz_i)`).
  - Recommendation datasets are stored per viewer and per library, so one viewer’s watch history does not contaminate another viewer’s recommendations.

- **Role-based pin targets**:
  - **Admin viewer** collections are pinned to **Library Recommended** and **Home**.
  - **Non-admin viewer** collections are pinned to **Friends Home**.

- **Why non-admin rows go to Friends Home**:
  - Due to current Plex limitations, shared viewers cannot reliably pin these server-managed rows to their own Home in this workflow.
  - The fallback is to pin those viewer-specific rows at the top of **Friends Home**.
  - Tradeoff: other viewers can see those rows there, but the recommendations inside each row are still generated from the owning viewer’s watch activity.

- **Fixed curated row order everywhere (suffix ignored)**:
  1. `Based on your recently watched ...`
  2. `Change of Taste`
  3. `Inspired by your Immaculate Taste`
  - Ordering/matching ignores trailing viewer name suffixes, so row priority stays deterministic across users.

- **Refresher behavior update**:
  - Collection-triggered/chained refresh remains scoped to the triggering viewer/library.
  - Standalone refresher runs (scheduled or manual Run Now without scope) sweep all eligible users/libraries, with deterministic user ordering and admin processed last.

- **Operational/UI updates included in this branch**:
  - User-aware Command Center reset controls and Plex-user dataset management.
  - Expanded debugger/logging surface and improved job run reporting for user/media context.

- **Plex library selection gate (setup + command center + runtime enforcement)**:
  - After Plex authentication in onboarding, there is now a dedicated **Plex Libraries** step.
  - Immaculaterr lists all eligible Plex libraries (`movie` + `show`) and preselects them by default.
  - You can deselect libraries you do not want included, but at least **1 library must remain selected**.
  - Selection can be changed later from **Command Center → Plex Library Selection** with the same minimum-1 guard.
  - The selection model is exclusion-based (`excludedSectionKeys`) so newly created Plex libraries are auto-included unless you explicitly exclude them.

- **How this changes automation behavior**:
  - **Auto triggers (Plex polling + webhook scrobble):** if the detected seed library is excluded, the collection automation is skipped with reason `library_excluded`.
  - **Collection jobs (manual + auto):** movie/TV library candidates are filtered by selection first.  
    If a seed resolves to an excluded library, the run is skipped (not failed).  
    If no selected libraries remain for the target media type, the run is skipped with explicit reasons (`no_selected_movie_libraries` / `no_selected_tv_libraries`).
  - **Refresher jobs:** targeted and sweep modes now operate only on selected libraries.  
    Excluded libraries are ignored across forced/sweep scopes, and “none available” results return a skipped summary instead of throwing.

- **Why this helps**:
  - Prevents unintended writes/collection rebuilds in libraries you want isolated (for example: kids, test, or archive libraries).
  - Keeps behavior predictable between onboarding, admin controls, auto-runs, and manual runs.
  - Improves observability with explicit skip reasons instead of generic failures.
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

### Install from the package

**Option A**

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

Tip: **Command Center → Reset Immaculate Taste Collection** deletes the Plex collection and clears the saved dataset for a selected library (then rerun the collection job to rebuild).

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
