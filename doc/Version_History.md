Version History
===

This file tracks notable changes by version.

1.5.2
---

- Per-viewer personalization for Movies + TV:
  - Curated rows are created per Plex viewer.
  - Recommendation datasets are isolated per viewer and per library.
- Role-based Plex pinning:
  - Admin rows pin to Library Recommended + Home.
  - Shared-user rows pin to Friends Home.
- Deterministic curated row ordering:
  - Based on your recently watched
  - Change of Taste
  - Inspired by your Immaculate Taste
- Plex library selection guardrails:
  - Configure included movie/show libraries in onboarding and Command Center.
  - New Plex movie/show libraries auto-enable unless disabled.
  - Disabled/unavailable libraries are skipped safely with clear report output.
- Refresher scoping improvements:
  - Chained refreshes stay scoped to triggering viewer/library.
  - Standalone sweeps run users/libraries in deterministic order, admin last.
- Plex user monitoring controls:
  - Any Plex user can be toggled off from monitoring.
  - Auto-triggered tasks skip users that are toggled off.
- Overseerr integration improvements:
  - Optional centralized missing-item flow per task card.
  - Command Center reset control for Overseerr requests.
- Observatory improvements:
  - Swipe-left adds a suggestion to the rejected list.
  - Command Center reset for rejected list.
  - Fixed black-screen crash and replaced library selector with a custom glass dropdown.
- Operational and compose/update-check reliability updates:
  - Expanded user-aware reset/debug/reporting coverage.
  - Compose keeps host networking with visible mapped ports.
  - Removed GitHub token env dependency from update checks.
- Cleanup After Adding New Content task now has independent action toggles:
  - Delete duplicate media
  - Unmonitor recently downloaded media in ARR
  - Remove recently added media from Plex watchlist
  - Any combination of toggles is supported; all OFF runs as a no-op with skipped actions in reports.

1.0.0.600
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
