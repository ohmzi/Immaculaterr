Setup Guide
===

This guide covers the quickest way to **pull the Docker image** and run Immaculaterr.

Prerequisites
---

- Docker
- A Plex server, TMDB API Key (It's Free)
- Optional integrations: Radarr, Sonarr, TMDB, OpenAI, Google

Pull the image
---

Images are published to **Docker Hub** (best for Portainer search/discovery) and **GHCR**.

- Latest (Docker Hub):

```bash
docker pull ohmzii/immaculaterr:latest
```

- Latest (GHCR):

```bash
docker pull ghcr.io/ohmzi/immaculaterr:latest
```

Run with Docker
---

Immaculaterr works best with **host networking** on Linux (so it can reach Plex/Radarr/Sonarr via `http://localhost:<port>`).

```bash
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

Then open:

- `http://<server-ip>:5454/`

Run with Docker Compose
---

Docker Compose templates are included in this repo under `docker/immaculaterr/`.

Immaculaterr works best with **host networking** on Linux (so it can reach Plex/Radarr/Sonarr via `http://localhost:<port>`). The provided compose files default to `network_mode: host`.

- Default (GHCR image, recommended):

```bash
cd docker/immaculaterr
docker compose -f docker-compose.yml up -d
```

- Docker Hub image (Portainer-friendly):

```bash
cd docker/immaculaterr
docker compose -f docker-compose.dockerhub.yml up -d
```

- Build locally from source (contributors / debugging):

```bash
cd docker/immaculaterr
docker compose -f docker-compose.source.yml up -d --build
```

Optional: set `APP_MASTER_KEY` via Compose secrets
---

An overlay file is provided: `docker/immaculaterr/docker-compose.secrets.yml`.

```bash
cd docker/immaculaterr
mkdir -p secrets
node ../../scripts/gen-master-key.mjs > secrets/app_master_key
chmod 600 secrets/app_master_key

docker compose -f docker-compose.yml -f docker-compose.secrets.yml up -d
```

Updating (Docker Compose)
---

```bash
cd docker/immaculaterr
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d
```

Logs / status (Docker Compose)
---

```bash
cd docker/immaculaterr
docker compose ps
docker compose logs -f immaculaterr
```


Updating
---

To update, pull the new tag and recreate the container (your volume stays intact).

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

Notes
---

- If you prefer GHCR, replace the image with `ghcr.io/ohmzi/immaculaterr:latest`.

Portainer (optional)
---

If you use Portainer and want a one-click deployment (no image typing/search), add this **App Template URL**:

- `https://raw.githubusercontent.com/ohmzi/Immaculaterr/develop/doc/portainer-templates.json`

In Portainer: **Settings → App Templates → URL → Save**. Then you can deploy the **Immaculaterr** template from the App Templates screen.

License
---

See [LICENSE](../LICENSE).

