Setup Guide
===

This guide covers the quickest way to **pull the Docker image** and run Immaculaterr.

Prerequisites
---

- Docker (and optionally Docker Compose)
- A Plex server (recommended)
- Optional integrations: Radarr, Sonarr, TMDB, OpenAI, Google

Pull the image
---

Images are published to GitHub Container Registry (GHCR).

- Latest:

```bash
docker pull ghcr.io/ohmzi/immaculaterr:latest
```

- Specific version (examples):

```bash
docker pull ghcr.io/ohmzi/immaculaterr:v0.0.0.101
# or
docker pull ghcr.io/ohmzi/immaculaterr:0.0.0.101
```

Run with Docker (Linux recommended)
---

Immaculaterr works best with **host networking** on Linux (so it can reach Plex/Radarr/Sonarr via `http://localhost:<port>`).

```bash
docker run -d \
  --name immaculaterr \
  --network host \
  -e HOST=0.0.0.0 \
  -e PORT=3210 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  ghcr.io/ohmzi/immaculaterr:latest
```

Then open:

- `http://<server-ip>:3210/`

Run with Docker Compose (example)
---

Create a file named `immaculaterr.compose.yml`:

```yaml
name: immaculaterr

services:
  immaculaterr:
    container_name: immaculaterr
    image: ghcr.io/ohmzi/immaculaterr:latest
    network_mode: host
    environment:
      - HOST=0.0.0.0
      - PORT=3210
      - APP_DATA_DIR=/data
      - DATABASE_URL=file:/data/tcp.sqlite
    volumes:
      - immaculaterr-data:/data
    restart: unless-stopped

volumes:
  immaculaterr-data:
    name: immaculaterr-data
```

Start it:

```bash
docker compose -f immaculaterr.compose.yml up -d
```

Updating
---

To update, pull the new tag and recreate the container:

```bash
docker pull ghcr.io/ohmzi/immaculaterr:latest
docker rm -f immaculaterr
# then re-run your docker run / compose up command
```

License
---

See [LICENSE](../LICENSE).

