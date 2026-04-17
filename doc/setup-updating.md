Setup: Updating
===

Update instructions for supported public deployment methods.

[← Back to Setup Guide](setupguide.md)

Docker Compose installs
---

Run these commands from the folder where your compose files live. If you followed the quick install, this is usually `/opt/immaculaterr`.

```bash
cd /opt/immaculaterr
```

If you used the install example, keep the `.env` file in this folder so `TZ=America/New_York` continues to apply after updates.

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

### HTTPS trust after update

If you use local HTTPS (`:5464`) and still get trust warnings, rerun:

```bash
./install-local-ca.sh
```

TrueNAS SCALE
---

TrueNAS Custom Apps use `pull_policy: always`, so recreating the app pulls the latest image automatically.

1. Go to **Apps → Installed Applications**.
2. Click the three-dot menu on the **immaculaterr** app, then **Edit**.
3. Click **Save** without changing anything. TrueNAS will repull the image and recreate the container.
4. If you use the HTTPS sidecar (`immaculaterr-https`), you only need to update the main app. The Caddy sidecar rarely needs updating.

Unraid
---

### Unraid Docker UI

1. Go to the **Docker** tab.
2. Click **Check for Updates** (or wait for the automatic check).
3. If an update is available for the Immaculaterr container, click **Update**.
4. The container will pull the latest image and recreate automatically.

### Docker Compose on Unraid

```bash
cd /mnt/user/appdata/immaculaterr
docker compose pull
docker compose up -d --force-recreate
```

If you want the container to stay on New York time after updates, keep `TZ=America/New_York` in the same compose file or `.env` you used for the install.

Portainer
---

In Portainer: **Immaculaterr Container -> Recreate -> enable Re-Pull Image -> Recreate**.
