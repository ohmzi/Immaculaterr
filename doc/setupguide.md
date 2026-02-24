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

Run with HTTP + HTTPS (Docker Compose)
---

This stack uses Caddy as a TLS reverse proxy in front of Immaculaterr while keeping host networking for local integrations.
It keeps both access paths available:

- HTTP on `5454` (backward compatibility and quick local access)
- HTTPS on `5464` (encrypted local/LAN browser traffic)

It auto-configures these HTTPS endpoints by default:

- `https://localhost:5464/`
- `https://<detected-lan-ip>:5464/` (for example `https://192.168.1.106:5464/`)

It also keeps HTTP available locally/LAN:

- `http://localhost:5454/`
- `http://<detected-lan-ip>:5454/`

```bash
cd docker/immaculaterr
docker compose -f docker-compose.https.yml up -d
```

Optional public domain support:

- Add `IMM_PUBLIC_DOMAIN=<your-domain>` to also serve `https://<your-domain>/` on port `443`.
- `IMM_PUBLIC_DOMAIN_TLS_MODE=public` (default) uses ACME/Let's Encrypt.
- Set `IMM_PUBLIC_DOMAIN_TLS_MODE=internal` if you want a local/internal cert instead.

Notes:

- The app itself runs on internal host port `5455` (`APP_INTERNAL_PORT`).
- Caddy serves local/LAN HTTP on `5454` (`IMM_HTTP_PORT`) and HTTPS on `5464` (`IMM_HTTPS_PORT`).
- Public domain HTTPS remains on `443`.
- Local endpoints (`localhost` + LAN IP) use Caddy's internal CA (`tls internal`).
- Recommended: install and trust the local CA once on each host to remove browser warnings:
```bash
cd docker/immaculaterr
./install-local-ca.sh
```
- If you do not install the local CA, you can still open HTTPS by accepting the browser risk warning page. Some browsers may require accepting this again in future sessions.
- If Firefox import is skipped, install `certutil` and rerun:
```bash
sudo apt-get install -y libnss3-tools
cd docker/immaculaterr
./install-local-ca.sh
```
- In this mode, `TRUST_PROXY=1` is enabled and cookie security is applied by request scheme (`https` requests are marked secure while `http` remains usable for compatibility).

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
