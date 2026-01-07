## Immaculaterr (Tautulli Curated Plex Collection)

This repo contains a **NestJS API** (`apps/api`) and a **React (Vite) web UI** (`apps/web`) for managing curated Plex collections and integrations (Plex/Radarr/Sonarr/TMDB/OpenAI/Google/Overseerr).

Legacy **Python / Tautulli script** automation (including `tautulli_immaculate_taste_collection.py`) has been removed in favor of the webapp-driven system.

### Development

- `npm install`
- `npm run dev` (API on `:3210`, web on `:5174`)

### Production (Docker)

- `docker compose -f docker/tautulli-curated-plex/docker-compose.yml up --build`


