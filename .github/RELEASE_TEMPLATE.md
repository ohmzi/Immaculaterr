## What's Changed

- <!-- Describe the most important user-facing changes here. -->

**Full Changelog**: https://github.com/ohmzi/Immaculaterr/compare/<previous-tag>..<new-tag>

## Updating

### Docker

HTTP-only update (required)

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

Optional HTTPS sidecar (can run anytime later)

```bash
mkdir -p ~/immaculaterr
curl -fsSL -o ~/immaculaterr/caddy-entrypoint.sh \
  "https://raw.githubusercontent.com/ohmzi/Immaculaterr/<release-tag>/docker/immaculaterr/caddy-entrypoint.sh"
chmod +x ~/immaculaterr/caddy-entrypoint.sh

docker pull caddy:2.8.4-alpine
docker rm -f ImmaculaterrHttps 2>/dev/null || true

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
```

### Portainer

1. In Portainer: **Containers** → select **Immaculaterr**
2. Click **Recreate**
3. Enable **Re-pull image**
4. Click **Recreate**
