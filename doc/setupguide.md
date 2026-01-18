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

- Build locally from sourcecode :

```bash
cd docker/immaculaterr
docker compose -f docker-compose.source.yml up -d --build
```

- GHCR image:

```bash
cd docker/immaculaterr
docker compose -f docker-compose.yml up -d
```

- Docker Hub image:

```bash
cd docker/immaculaterr
docker compose -f docker-compose.dockerhub.yml up -d
```


Updating (Docker Compose)
---

```bash
cd docker/immaculaterr
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d
```

Updating (Portainer)
---

In Portainer: **Immaculaterr Container → Recreate → toggle Re-Pull Image → Recreate**. 
Then Portainer will pull the latest image.


Updating (Docker)
---
- If you prefer GHCR, replace the image with `ghcr.io/ohmzi/immaculaterr:latest`.

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

License
---

See [LICENSE](../LICENSE).

