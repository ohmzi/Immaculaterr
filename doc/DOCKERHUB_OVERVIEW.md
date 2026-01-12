<div align="center">
  <img src="https://raw.githubusercontent.com/ohmzi/Immaculaterr/master/doc/assets/readme-header.png" alt="Immaculaterr banner" width="100%" />
</div>

<div align="center">
  <p>
    A Plex “autopilot” that watches what you’re watching, builds curated collections, and keeps your library tidy — without the babysitting.
  </p>
</div>

## Quick start (Docker)

```bash
docker pull ohmzii/immaculaterr:latest

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

Then open: `http://<server-ip>:5454/`

## What it does

- Plex-triggered automation + scheduled jobs
- Curated collections (“Inspired by your Immaculate Taste”, “Based on your recently watched”, “Change of Taste”)
- Recommendations (TMDB; optional Google + OpenAI)
- Radarr + Sonarr integration (optional)
- Step-by-step job reports & logs

## Docs / Support

- GitHub repo: https://github.com/ohmzi/Immaculaterr
- Setup guide: https://github.com/ohmzi/Immaculaterr/blob/master/doc/setupguide.md
- FAQ: https://github.com/ohmzi/Immaculaterr/blob/master/doc/FAQ.md
- Issues: https://github.com/ohmzi/Immaculaterr/issues

