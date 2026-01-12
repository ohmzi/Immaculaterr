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
  --name Immaculaterr \
  --network host \
  -e HOST=0.0.0.0 \
  -e PORT=5454 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  ghcr.io/ohmzi/immaculaterr:latest
```

Then open:

- `http://<server-ip>:5454/`


Updating
---

To update, pull the new tag and recreate the container (your volume stays intact).

```bash
docker pull ghcr.io/ohmzi/immaculaterr:latest

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
  ghcr.io/ohmzi/immaculaterr:latest
```

Portainer (optional)
---

If you use Portainer and want a one-click deployment (no image typing/search), add this **App Template URL**:

- `https://raw.githubusercontent.com/ohmzi/Immaculaterr/develop/doc/portainer-templates.json`

In Portainer: **Settings → App Templates → URL → Save**. Then you can deploy the **Immaculaterr** template from the App Templates screen.

License
---

See [LICENSE](../LICENSE).

