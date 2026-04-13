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

- **Watches Plex activity and reacts right away**
  - When a movie or show episode is watched, Immaculaterr observes that from Plex will trigger the task to automatically create Collections.
  - Pins these Collections them on top on Homescreen so user can then get better suggestion and also fresh looking Homescreen like Netflix.
  - If any movie or show that TMDB suggestion, thats not already in library, Immaculaterr then sends request to downloan to Seerr/Radarr/Sonarr.

- **Collections Built by Immaculaterr**
  - `Immaculate Taste` for your long-term observation and suggestions
  - `Based on your recently watched` for quick post-watch collection, updates after every newly watched media
  - `Change of Taste` same as Based on your recently watched but polar opposite of those suggestions so may be provide different kind of suggestions
  - You can run multiple `Immaculate Taste` profiles side by side, each with its own download route, folder, naming rules, and fallback naming, such as have a seperate collection for Animation, Action, Specific Language, keep default collection on or turn it off. Lots of ways to modify the Immaculate Taste collection. 

- **Lets you create multiple profiles for Immaculate Taste**
  - You can run multiple `Immaculate Taste` profiles side by side, each with its own download route, folder, naming rules, and fallback naming. 
  - Filter by genre and audio language per profile to narrow or expand what gets recommended. You can add different collections on homescreen for specific genre like Animation Only or Comedy and Family Movies Collection or Specific Language only Collection. Design the homescreen as you wish to see it.
  - The better you tune these profile, The Better matching means fewer unwanted titles and more useful suggestions

- **Runs background jobs on a schedule**
  - It refreshs suggestion rows, fetch new content, and keep your Plex home screen moving even when nobody is actively watching.
  - Never have stale looking homescreen again.

- **Queues jobs safely instead of stampeding Plex**
  - Manual runs, schedules, Plex webhooks, and Plex polling all feed into one persisted FIFO queue.
  - After each run, Immaculaterr waits about 1 minute before starting the next queued job so Plex and upstream services get a breather.
  - Pending work survives restarts, duplicate auto-runs are skipped cleanly, and Rewind shows queued/running status with ETA context.

- **Builds a Fresh Out Of The Oven row**
  - Creates a recent-release movie row on homescreen of the movies that have been released last 3 months
  - Only shows movies that specific user has not watched yet

- **Builds a TMDB Upcoming Movie row**
  - Pulls upcoming movie picks from TMDB. So your collection is always upto date with the latest movies and shows being released. 
  - You can shape the results with filters like streaming service, genre, language, and score
  - Top matches can be sent to Radarr directly or routed through Seerr

- **Keeps recommendations personal for every viewer**
  - Each Plex user gets their own rows, such as *Based on your recently watched — Jane*
  - Watch history stays separate, so one person's habits do not affect anyone else's results

- **Pins rows where Plex will actually show them**
  - Admin rows appear in Library Recommended and Home
  - Shared-user rows appear in Friends Home *(current Plex limitation for non-admins)*

- **Uses more than one recommendation source**
  TMDB is the default source, with optional Google and OpenAI support when you want broader or more refined results.

- **Remembers what it already suggested**
  A local database tracks previous recommendations so Immaculaterr can avoid repeats and notice when a suggested title finally lands in your Plex library.

- **Lets you choose which libraries take part**
  - Pick your movie and TV libraries during setup, then change them later from Command Center if needed
  - New libraries are included automatically unless you turn them off
  - If a library is unavailable during a run, that part is skipped and noted in the report instead of breaking the whole job

- **Refreshes only what needs refreshing**
  - Watch-triggered updates stay scoped to the right viewer and library
  - Scheduled or manual full runs still process all eligible users and libraries in a consistent order, with the admin handled last

- **Sends missing titles to your download stack**
  - When Seerr is off, missing movies and shows can go straight to Radarr and Sonarr
  - If you prefer an approval flow, you can enable Seerr on a per-task basis instead of using one global setting
  - Different tasks can use different routing flows, and you can clear all Seerr requests at once from Command Center when needed

- **Includes Observatory for managing suggestions**
  - Swipe to approve download requests when approval mode is on
  - Swipe left to reject a title and keep it from coming back
  - Clear rejected items later from Command Center whenever you want a reset

- **Supports custom posters for generated collections**
  - Upload your own posters for any collection Immaculaterr creates
  - Preview and manage them from Command Center
  - Posters are stored so they survive restarts and updates

- **Netflix Watch History Import**
  - Upload your Netflix viewing activity CSV and Immaculaterr classifies each title via TMDB, generates similar and change-of-taste recommendations, and writes the results into Plex collections
  - Seed recommendations from day one without waiting for Plex watch events to accumulate

- **Plex Watch History Import**
  - Opt in during setup or trigger manually from Task Manager to scan your existing Plex watch history
  - Already-watched movies and TV shows are matched to TMDB automatically (no CSV needed), then the same recommendation pipeline builds curated Plex collections from your viewing history
  - Works alongside Netflix import — titles processed by one source are not duplicated by the other

- **Keeps a full report of every run**
  Every job includes step-by-step logs, metrics, and history so you can see what ran, what was skipped, and why.
  Immaculate Taste reports also show the generated titles, Plex matches, and exactly which titles were newly added to each managed collection, including profile-specific collections.

- **Puts management in Command Center**
  Manage users, datasets, resets, posters, rejected items, and request cleanup from one place.

- **Coming soon**
  - Discovering content from film industries around the world
  - Email reports on your media server's health
  - Windows and macOS support

## How recommendations are built

1. A watch event, manual run, or history import supplies a seed title.
2. TMDB resolves the seed metadata and builds released, upcoming, and fallback candidate pools.
3. Optional Google search can widen discovery, and optional OpenAI can curate the final list from TMDB-validated candidates.
4. The final titles are deduped, capped to the run limit, matched against Plex, and tracked as active or pending. For Immaculate Taste, profile genre and language rules are applied before points are updated.
5. Refreshers rebuild each managed collection and now report exactly which titles were newly added to that specific collection, including separate profile lanes such as Animation.


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
