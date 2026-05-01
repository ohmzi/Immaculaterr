Setup Guide
===

This guide covers the supported public install paths for Immaculaterr. Use the official Docker images and the platform guides below.

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
cat > .env <<'EOF'
TZ=America/New_York
EOF

docker rm -f Immaculaterr ImmaculaterrHttps 2>/dev/null || true

IMM_IMAGE=ohmzii/immaculaterr IMM_TAG=latest docker compose -f docker-compose.dockerhub.yml up -d --force-recreate
cd /opt/immaculaterr
./install-local-ca.sh
```

Then open:

- `http://<server-ip>:5454/`
- `https://<server-ip>:5464/`

The `.env` file above sets the app container timezone to `America/New_York`. Change it if you prefer a different IANA timezone.

Optional: host under an app base path
---

`APP_BASE_PATH` is only the public path prefix for the app. Do not put a full URL, domain, protocol, or port in this value.

Leave `APP_BASE_PATH` unset if Immaculaterr is served at the site root. Set it and keep `TRUST_PROXY=1` only when a reverse proxy or tunnel serves the app from a subpath.

Replace `/immaculaterr` below with any subpath you want, such as `/recommendations` or `/media-helper`.

Example `.env` additions:

```env
APP_BASE_PATH=/immaculaterr
TRUST_PROXY=1
```

Then browse to:

- `http://<server-ip>:5454/immaculaterr/`
- `https://<server-ip>:5464/immaculaterr/`

Make sure your proxy preserves and forwards that same prefix to Immaculaterr. This works with nginx, Caddy, Traefik, Cloudflare Tunnel, Tailscale Funnel, and similar setups.

In the app, use `Setup` for the hosting walkthrough, then open `Profile` to confirm the active `App base path` value. Root deployments should show `/`. Subpath deployments should show the exact configured prefix.

Example nginx reverse proxy:

```nginx
location = /immaculaterr {
  return 301 /immaculaterr/;
}

location /immaculaterr/ {
  proxy_pass http://127.0.0.1:5454;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Port $server_port;
}
```

Compose stacks at a glance
---

Supported compose templates live in `docker/immaculaterr/`:

- `docker-compose.yml`: GHCR image, HTTP only (`:5454`)
- `docker-compose.https.yml`: GHCR image + Caddy sidecar, HTTP (`:5454`) + HTTPS (`:5464`)
- `docker-compose.dockerhub.yml`: Docker Hub image + Caddy sidecar, HTTP (`:5454`) + HTTPS (`:5464`)
- `docker-compose.secrets.yml`: optional overlay to load `APP_MASTER_KEY_FILE` from Docker secrets

These compose files use `network_mode: host` by default. On Linux, this keeps local integrations simple (`http://localhost:<port>` from inside the app).
If you want New York time in the app container, add `TZ=America/New_York` to the `.env` file next to the compose file.
If you want subpath hosting, also add `APP_BASE_PATH=/immaculaterr` (or your own chosen subpath). Leave it unset for root deployments.

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
- [Updating](setup-updating.md) — Update instructions for all deployment methods including Portainer.

License
---

See [LICENSE](../LICENSE).
