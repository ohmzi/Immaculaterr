## What's New

- <!-- Describe the most important user-facing changes here. -->

Full Changelog: https://github.com/ohmzi/Immaculaterr/compare/<previous-tag>..<new-tag>

## Licensing

Official Docker images and release artifacts are provided for personal, noncommercial self-hosting only. The public source repository remains visible for transparency and reference, but the source code is not licensed for reuse. See [LICENSE](https://github.com/ohmzi/Immaculaterr/blob/master/LICENSE).

If you are running NAS or Unraid please check their specific documentation for update
[NAS](https://github.com/ohmzi/Immaculaterr/blob/master/doc/setup-truenas.md)
[Unraid](https://github.com/ohmzi/Immaculaterr/blob/master/doc/setup-unraid.md)

## Updating

### Docker

HTTPS update which includes sidecar

```bash
set -euo pipefail

IMM_IMAGE="ghcr.io/ohmzi/immaculaterr:latest"

mkdir -p ~/immaculaterr
curl -fsSL -o ~/immaculaterr/caddy-entrypoint.sh \
  "https://raw.githubusercontent.com/ohmzi/Immaculaterr/<release-tag>/docker/immaculaterr/caddy-entrypoint.sh"
curl -fsSL -o ~/immaculaterr/install-local-ca.sh \
  "https://raw.githubusercontent.com/ohmzi/Immaculaterr/<release-tag>/docker/immaculaterr/install-local-ca.sh"
chmod +x ~/immaculaterr/caddy-entrypoint.sh ~/immaculaterr/install-local-ca.sh

if ! command -v certutil >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y libnss3-tools
fi

docker pull "$IMM_IMAGE"
docker pull caddy:2.8.4-alpine
docker rm -f ImmaculaterrHttps 2>/dev/null || true
docker rm -f Immaculaterr 2>/dev/null || true
docker volume create immaculaterr-caddy-data >/dev/null 2>&1 || true
docker volume create immaculaterr-caddy-config >/dev/null 2>&1 || true

docker run -d \
  --name ImmaculaterrHttps \
  --network host \
  -e IMM_ENABLE_HTTP=false \
  -e IMM_ENABLE_HTTPS=true \
  -e IMM_HTTPS_PORT=5464 \
  -e IMM_INCLUDE_LOCALHOST=true \
  -e IMM_ENABLE_LAN_IP=true \
  -e APP_INTERNAL_PORT=5454 \
  -v ~/immaculaterr/caddy-entrypoint.sh:/etc/caddy/caddy-entrypoint.sh:ro \
  -v immaculaterr-caddy-data:/data \
  -v immaculaterr-caddy-config:/config \
  --restart unless-stopped \
  caddy:2.8.4-alpine \
  /bin/sh /etc/caddy/caddy-entrypoint.sh

docker run -d \
  --name Immaculaterr \
  -p 5454:5454 \
  -e HOST=0.0.0.0 \
  -e PORT=5454 \
  -e TRUST_PROXY=1 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  "$IMM_IMAGE"

"$HOME/immaculaterr/install-local-ca.sh"

curl -I https://localhost:5464
```

HTTP-only update

```bash
IMM_IMAGE="ghcr.io/ohmzi/immaculaterr:latest"
APP_PORT=5454

docker pull "$IMM_IMAGE"
docker rm -f ImmaculaterrHttps 2>/dev/null || true
docker rm -f Immaculaterr 2>/dev/null || true

docker run -d \
  --name Immaculaterr \
  -p ${APP_PORT}:${APP_PORT} \
  -e HOST=0.0.0.0 \
  -e PORT=${APP_PORT} \
  -e TRUST_PROXY=1 \
  -e APP_DATA_DIR=/data \
  -e DATABASE_URL=file:/data/tcp.sqlite \
  -v immaculaterr-data:/data \
  --restart unless-stopped \
  "$IMM_IMAGE"
```

### Portainer

1. In Portainer: **Containers** -> select **Immaculaterr**
2. Click **Recreate**
3. Enable **Re-pull image**
4. Click **Recreate**
