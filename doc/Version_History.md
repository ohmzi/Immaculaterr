Version History
===

This file tracks notable changes by version.

1.0.0.532
---

- Web: fix Observatory page black-screen crash caused by Radix Select + React 19 ref loop.
- Web: replace Observatory library dropdown with a custom glass dropdown (matches app styling).

1.0.0.530
---

- Compose: keep host networking with visible port mappings.
- Compose: remove GitHub token env from update checks.

1.0.0.0
---

- Plex-triggered automation:
  - Automatically reacts to Plex library activity and runs smart workflows in real time.
- Scheduler automation:
  - Off hours fetching media or refreshing the Plex home screen.
- Curated Movies and TV Shows collections:
  - Inspired by your Immaculate Taste (long term collection)
  - Based on your recently watched (refreshes on every watch)
  - Change of Taste (refreshes on every watch)
- Recommendation engine:
  - TMDB-powered suggestions
  - Optional - Google + OpenAI
- Keeps a snapshot database:
  - Recommmended database for refresher task to monitor titles as they become available in Plex.
- Radarr + Sonarr integration:
  - Seamlessly organizes your media collection and automatically sends movies and series to ARR downloaders for monitoring and acquisition.
- Observatory:
  - Swipe to approve download requests (optional “approval required” mode), curate suggestions.
- Job reports & logs:
  - Step-by-step breakdowns, metrics tables, and run history.

