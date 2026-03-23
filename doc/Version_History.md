Version History
===

This file tracks notable changes by version.

1.7.2-beta-2
---

- What's new since 1.7.0:
- Fresh Out Of The Oven task:
  - Added a per-user recent-release movie collection built from the last 3 months of library titles.
  - Each user only sees titles they have not watched, while the shared recent-release baseline stays user-independent.
  - Fresh Out Of The Oven pins to Home for admin, Shared Home for shared users, and stays last within Immaculaterr-managed movie rows.
  - Task Manager now includes a Fresh Out Of The Oven job with Run Now plus optional schedule enablement.
- TMDB Upcoming Movie task:
  - Added customizable filter sets with where-to-watch, genre, language, certification, and score controls.
  - Each filter set can be tuned independently so upcoming picks match different preferences or use cases.
  - Top picks can route directly to Radarr by default or through Seerr when route-via-Seerr is enabled.
- Integration connectivity hardening:
  - TMDB, OpenAI, and Google now retry with explicit IPv4 fallback when normal requests fail due to DNS/IPv6 network issues.
  - This improves API-key validation reliability in Docker environments with unstable resolver behavior.
  - Added focused test coverage for fallback behavior and non-fallback auth failure handling.
- TrueNAS and Unraid setup guidance:
  - Added dedicated in-app setup guides at `/setup/truenas` and `/setup/unraid` with copy-ready app and HTTPS-sidecar examples.
  - Setup page now links directly to both guides for faster navigation.
  - Updated setup docs with TrueNAS and Unraid deployment flows, local CA trust steps, and HTTPS verification commands.


1.7.0
---

- Password recovery and reset:
  - Added forgot-password and password reset using security-question verification.
  - Prompting pre-existing profile with Forced password recovery upon update.
  - New Profile Page for password recovery management and changing password.
- Profile lanes for Immaculate Taste collections:
  - Immaculate Taste profiles let each collection strategy run with its own rules.
  - Multiple collections can run at the same time with different smart filters.
  - Each profile can follow its own Radarr/Sonarr route so requests go to the right server.
  - Default behavior stays simple, and advanced profile controls only appear when needed.
- Smart filters for Immaculate Taste:
  - Include/exclude filters for genre and audio language make profile tuning simple.
  - Profile rules keep recommendations closer to each profile's goal.
  - This keeps unwanted titles out and makes results feel more accurate.
- Poster style control:
  - Custom poster upload is available for all collections created by Immaculaterr.
  - Poster files stay saved in app data so the look remains consistent after restarts.
  - Collections are easier to recognize and feel more personalized in Plex.

1.6.1
---

- Better API key protection:
  - API keys are protected during save/test and unsafe key submissions are blocked by default.
  - After setup, the app uses secure references instead of resending raw keys.
  - Secret values stay hidden in Vault (`*******`) and are not returned in settings.
- Security updates behind the scenes:
  - Updated vulnerable dependency paths to safer versions.
  - Hardened runtime container dependencies.
  - Runtime images prune dev-only dependency chains to reduce exposure.
- Access options:
  - HTTP on `5454` for backward compatibility.
  - HTTPS on `5464` for encrypted local/LAN access (optional domain HTTPS on `443`).
- Added security tests for key handling and transport safety.

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
- Seerr integration improvements:
  - Optional centralized missing-item flow per task card.
  - Command Center reset control for Seerr requests.
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
