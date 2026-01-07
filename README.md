## Immaculaterr (Tautulli Curated Plex Collection)

This repo contains a **NestJS API** (`apps/api`) and a **React (Vite) web UI** (`apps/web`) for managing curated Plex collections and integrations (Plex/Radarr/Sonarr/TMDB/OpenAI/Google/Overseerr).

Legacy **Python / Tautulli script** automation (including `tautulli_immaculate_taste_collection.py`) has been removed in favor of the webapp-driven system.

### Development

- `npm install`
- `npm run dev` (API on `:3210`, web on `:5174`)

### Production (Docker)

- `docker compose -f docker/tautulli-curated-plex/docker-compose.yml up --build`

### Master key (recommended hardening)

The API encrypts stored secrets (Radarr/Sonarr keys, etc.) using a **32‑byte master key**.

- **Preferred**: provide the key via deployment secrets:
  - `APP_MASTER_KEY` (base64 32 bytes **or** 64-char hex)
  - or `APP_MASTER_KEY_FILE` (path to a file containing the key; works well with Docker secrets)
- **Fallback (legacy)**: if neither is set, the API will use/create `APP_DATA_DIR/app-master.key`.

#### Generate a new key

```bash
node scripts/gen-master-key.mjs
# or: npm run -s gen:master-key
```

#### Docker secrets (recommended)

```bash
mkdir -p docker/tautulli-curated-plex/secrets
node scripts/gen-master-key.mjs > docker/tautulli-curated-plex/secrets/app_master_key
chmod 600 docker/tautulli-curated-plex/secrets/app_master_key

docker compose \
  -f docker/tautulli-curated-plex/docker-compose.yml \
  -f docker/tautulli-curated-plex/docker-compose.secrets.yml \
  up --build
```

#### Migrate from the existing `data/app-master.key`

If you already have `/data/app-master.key` (or `./data/app-master.key` in dev), set:

```bash
export APP_MASTER_KEY="$(cat data/app-master.key)"
```

Restart the API, confirm things work, then you can delete `data/app-master.key` so it’s no longer stored next to the DB.

#### File/dir permissions

- The API now sets a secure default `umask` (override with `APP_UMASK`, octal) and will best-effort tighten:
  - `APP_DATA_DIR` to remove world access
  - file-based DB (`file:...`) to `0600`
  - `app-master.key` to `0600`

You should also ensure:
- `APP_DATA_DIR` is not world-readable
- backups containing secrets/DB are encrypted + access-restricted


