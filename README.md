# Immaculaterr

Monorepo with:

- **API**: NestJS (`apps/api`) — serves the REST API under `/api`
- **Web UI**: React + Vite (`apps/web`)

In **Docker / production**, the API serves the built UI too, so there is **one port** for both the UI and `/api`.

## Development (local)

### Requirements

- Node.js **20+**
- npm

### Start dev mode (API + Web)

```bash
npm install
npm -w apps/api run db:generate
# First run only: create the dev DB + tables (SQLite)
APP_DATA_DIR=./data DATABASE_URL=file:./data/tcp.sqlite npm -w apps/api run db:migrate
npm run dev
```

Defaults:

- **API**: `http://localhost:3210/api`
- **Web**: `http://localhost:5175/` (LAN: `http://<your-lan-ip>:5175/`)

### Change dev ports

```bash
PORT=3211 WEB_PORT=5176 npm run dev
```

You can also run them individually:

```bash
npm run dev:api
npm run dev:web
```

## Docker (recommended for deployment)

### Run (pull from GitHub Container Registry)

This repo publishes official images to **GitHub Container Registry (GHCR)**:

- `ghcr.io/ohmz/immaculaterr:latest`
- `ghcr.io/ohmz/immaculaterr:vX.X.X.X` / `ghcr.io/ohmz/immaculaterr:X.X.X.X`

```bash
docker compose -f docker/immaculaterr/docker-compose.yml pull
docker compose -f docker/immaculaterr/docker-compose.yml up -d
```

Open:

- `http://<server-ip>:3210/`

This Docker Compose runs Immaculaterr with **host networking by default** (Linux), so it behaves like
many media-stack containers (Radarr/Sonarr/etc):

- No port publishing/mapping needed
- The app binds directly to the host network on `PORT` (default `3210`)

### Connecting to Plex/Radarr/Sonarr when Immaculaterr runs in Docker

With **host networking**, you can usually use `http://localhost:<port>` as the Base URL (example:
Plex: `http://localhost:32400`).

If you switch Immaculaterr to Docker **bridge** networking later, then `localhost` will refer to the
container — use your service’s **LAN IP** instead (example: `http://192.168.1.10:32400`).

### Auto-run on watched (no Plex webhook setup required)

Immaculaterr can detect “finished watching” by **polling Plex now-playing sessions** (Tautulli-style),
so you do **not** need to configure Plex Webhooks.

Then in Immaculaterr:

- Task Manager → enable **Auto-run** for the jobs you want
  - “Based on Latest Watched Collection” (`watchedMovieRecommendations`)
  - “Immaculate Taste Collection” (`immaculateTastePoints`)
  - “Media Added Cleanup” (`mediaAddedCleanup`) *(optional; runs when new items are added)*

Optional: if you *do* want Plex to push events instead of polling, you can configure Plex Webhooks:

- Plex Settings → **Webhooks** → Add:
  - `http://<host-ip>:3210/api/webhooks/plex`
  - (Also works: `http://<host-ip>:3210/webhooks/plex`)

#### Polling settings (optional)

- `PLEX_POLLING_ENABLED` (default: `true`)
- `PLEX_POLLING_INTERVAL_MS` (default: `5000`)
- `PLEX_POLLING_SCROBBLE_THRESHOLD` (default: `0.7` i.e. 70%)
- `PLEX_POLLING_RECENTLY_ADDED_INTERVAL_MS` (default: `60000`)
- `PLEX_POLLING_LIBRARY_NEW_DEBOUNCE_MS` (default: `120000`)

### Stop

```bash
docker compose -f docker/immaculaterr/docker-compose.yml down
```

### Update to the latest version

```bash
docker compose -f docker/immaculaterr/docker-compose.yml pull
docker compose -f docker/immaculaterr/docker-compose.yml up -d
```

When a newer version is available, the web UI will show:

- a **toast** on open (top of the app)
- a **Help menu** indicator (shows `vX.X.X.X available`)

### Change the external port (Radarr-style)

With host networking, the “external port” is just the app listen port. Set `APP_PORT` (or `PORT`)
to change it.

Example: expose on `13378`:

```bash
APP_PORT=13378 docker compose -f docker/immaculaterr/docker-compose.yml up -d --build
```

Then open:

- `http://<server-ip>:13378/`

### Portainer mapping tip

If you use Portainer:

- Set the container **network mode** to **host**
- Set env **`APP_PORT`** (or `PORT`) if you want a non-default port

## Publishing to GHCR

This repo includes a GitHub Actions workflow that builds and publishes images to GHCR on git tags
matching `v*`.

### Release a new version

Example (first release):

```bash
git tag v0.0.0.100
git push origin v0.0.0.100
```

That will:

- build and push multi-arch images to GHCR
- create a GitHub Release for the tag (used by the in-app update checker)

