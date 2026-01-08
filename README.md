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

### Build + run

```bash
docker compose -f docker/immaculaterr/docker-compose.yml up -d --build
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

### Stop

```bash
docker compose -f docker/immaculaterr/docker-compose.yml down
```

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

