Setup: Updating
===

Update instructions for all deployment methods.

[← Back to Setup Guide](setupguide.md)

From a clone
---

```bash
cd docker/immaculaterr
```

### Update GHCR (HTTP only)

```bash
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d --force-recreate
```

### Update GHCR + HTTPS sidecar

```bash
docker compose -f docker-compose.https.yml pull
docker compose -f docker-compose.https.yml up -d --force-recreate
```

### Update Docker Hub + HTTPS sidecar

```bash
docker compose -f docker-compose.dockerhub.yml pull
docker compose -f docker-compose.dockerhub.yml up -d --force-recreate
```

### Update source build stack

```bash
docker compose -f docker-compose.source.yml up -d --build
```

### HTTPS trust after update

If you use local HTTPS (`:5464`) and still get trust warnings, rerun:

```bash
./install-local-ca.sh
```

Portainer
---

In Portainer: **Immaculaterr Container -> Recreate -> enable Re-Pull Image -> Recreate**.
