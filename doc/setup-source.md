Setup: Run from source
===

Run Immaculaterr from a cloned copy of the repository using the compose stacks in `docker/immaculaterr/`.

> Warning: this page is a technical reference for the project owner and separately authorized developers. Public visibility of the repository does not grant permission to use, modify, redistribute, or build derivative artifacts from the source code. End users should install the official Docker images or release artifacts instead.

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

Build from source (authorized development only)
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
