## What’s New

- <!-- Describe the most important user-facing changes here. -->

## Update

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

