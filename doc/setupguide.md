Setup Guide
===

This guide covers the recommended Docker install for Immaculaterr. Platform-specific guides, source builds, updating, and local development are linked below.

Prerequisites
---

- Docker and Docker Compose v2
- A Plex server
- A TMDB API key (configured in Vault after first sign-in)
- Optional integrations: Radarr, Sonarr, Seerr, OpenAI, Google

Quick install (recommended)
---

Use the Docker Hub compose stack (app + Caddy sidecar) so HTTP and HTTPS are both available.

```bash
mkdir -p /opt/immaculaterr
cd /opt/immaculaterr

curl -fsSL -o docker-compose.dockerhub.yml https://raw.githubusercontent.com/ohmzi/Immaculaterr/master/docker/immaculaterr/docker-compose.dockerhub.yml
curl -fsSL -o caddy-entrypoint.sh https://raw.githubusercontent.com/ohmzi/Immaculaterr/master/docker/immaculaterr/caddy-entrypoint.sh
curl -fsSL -o install-local-ca.sh https://raw.githubusercontent.com/ohmzi/Immaculaterr/master/docker/immaculaterr/install-local-ca.sh
chmod +x caddy-entrypoint.sh install-local-ca.sh

docker rm -f Immaculaterr ImmaculaterrHttps 2>/dev/null || true

IMM_IMAGE=ohmzii/immaculaterr IMM_TAG=latest docker compose -f docker-compose.dockerhub.yml up -d --force-recreate
cd /opt/immaculaterr
./install-local-ca.sh
```

Then open:

- `http://<server-ip>:5454/`
- `https://<server-ip>:5464/`

Compose stacks at a glance
---

Compose templates live in `docker/immaculaterr/`:

- `docker-compose.yml`: GHCR image, HTTP only (`:5454`)
- `docker-compose.source.yml`: build from local source, HTTP only (`:5454`)
- `docker-compose.https.yml`: GHCR image + Caddy sidecar, HTTP (`:5454`) + HTTPS (`:5464`)
- `docker-compose.dockerhub.yml`: Docker Hub image + Caddy sidecar, HTTP (`:5454`) + HTTPS (`:5464`)
- `docker-compose.secrets.yml`: optional overlay to load `APP_MASTER_KEY_FILE` from Docker secrets

These compose files use `network_mode: host` by default. On Linux, this keeps local integrations simple (`http://localhost:<port>` from inside the app).

Optional: Docker secret for APP_MASTER_KEY
---

For persistent encrypted secret handling, use a stable master key with the secrets overlay:

```bash
cd docker/immaculaterr
mkdir -p secrets
openssl rand -hex 32 > secrets/app_master_key
chmod 600 secrets/app_master_key
```

Example with Docker Hub HTTPS stack:

```bash
docker compose -f docker-compose.dockerhub.yml -f docker-compose.secrets.yml up -d
```

Notes:

- `APP_MASTER_KEY_FILE` from `docker-compose.secrets.yml` points to `/run/secrets/app_master_key`.
- If you do not provide `APP_MASTER_KEY` or `APP_MASTER_KEY_FILE`, the app creates a key file in the data directory.

Other guides
---

- [TrueNAS SCALE](setup-truenas.md) — GUI-only Custom Apps with HTTPS and HTTP-only options.
- [Unraid](setup-unraid.md) — Docker template and compose setup with HTTPS and HTTP-only options.
- [Run from source](setup-source.md) — Clone the repo and run compose stacks or build from source.
- [Updating](setup-updating.md) — Update instructions for all deployment methods including Portainer.
- [Local development](setup-development.md) — Run the monorepo locally for development.

License
---

See [LICENSE](../LICENSE).
