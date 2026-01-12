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

Images are published to GitHub Container Registry (GHCR).

- Latest:

```bash
docker pull ghcr.io/ohmzi/immaculaterr:latest
```

Run with Docker
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


Updating
---

To update, pull the new tag and restart the service.

```bash
docker pull ghcr.io/ohmzi/immaculaterr:latest
docker compose up -d immaculaterr
```

Notes:

- If you see `no configuration file provided`, you’re not in a folder with a Compose file.
  - Run from the folder that contains your `compose.yml` / `docker-compose.yml`, **or**
  - Add `-f <path-to-your-compose-file>` to the command.
- If you started Immaculaterr with `docker run`, you’ll need to recreate the container after pulling (the volume stays intact).

License
---

See [LICENSE](../LICENSE).

