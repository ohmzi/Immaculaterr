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

### Connecting to Plex/Radarr/Sonarr when Immaculaterr runs in Docker

If another service (like Plex) is running **on the Docker host**, do **not** use `http://localhost:...` as the Base URL inside Immaculaterr — in Docker, `localhost` means **inside the container**.

Use one of:

- `http://host.docker.internal:<port>` (recommended; supported by this compose file on Linux)
- `http://<host-lan-ip>:<port>` (example: `http://192.168.1.10:32400`)

### Stop

```bash
docker compose -f docker/immaculaterr/docker-compose.yml down
```

### Change the external port (Radarr-style)

Set `HOST_PORT` to pick the port you connect to (host-side). The container still listens on `3210` internally.

Example: expose on `13378`:

```bash
HOST_PORT=13378 docker compose -f docker/immaculaterr/docker-compose.yml up -d --build
```

Then open:

- `http://<server-ip>:13378/`

### Portainer mapping tip

If you’re mapping ports manually:

- **Container port**: `3210` (or whatever you set as `APP_PORT`)
- **Host port**: whatever you want (e.g. `13378`)

