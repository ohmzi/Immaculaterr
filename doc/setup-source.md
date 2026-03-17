Setup: Run from source
===

Run Immaculaterr from a cloned copy of the repository using the compose stacks in `docker/immaculaterr/`.

[← Back to Setup Guide](setupguide.md)

Getting started
---

```bash
cd docker/immaculaterr
```

GHCR (HTTP only)
---

```bash
docker compose -f docker-compose.yml up -d
```

Build from source (HTTP only)
---

```bash
docker compose -f docker-compose.source.yml up -d --build
```

GHCR + built-in HTTPS sidecar
---

```bash
docker compose -f docker-compose.https.yml up -d
```

Docker Hub + built-in HTTPS sidecar
---

```bash
docker compose -f docker-compose.dockerhub.yml up -d
```
