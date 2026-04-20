Version History
===

This file tracks notable changes by version.

1.7.8-beta-2
---

- What's new in 1.7.8 beta 1:
- Netflix import reliability (issue #199):
  - Fixed `/api/import/netflix` failing with "column `releaseDate` does not exist" on older SQLite databases whose schema had drifted from the Prisma schema.
  - `ImmaculateTasteMovieLibrary` and `ImmaculateTasteShowLibrary` rebuild paths now preserve `releaseDate` and `firstAirDate` instead of silently dropping them.
  - Added an idempotent startup step that restores `releaseDate` and `firstAirDate` plus their indexes regardless of migration history state.
- Testing:
  - Added 14 new unit tests in `migrate-with-repair.spec.ts` covering every new ensure function.

1.7.7
---

- What's new in 1.7.7:
- Smarter recommendations:
  - Replaced the older heuristic scoring with a multi-factor ranking engine that balances similarity, quality, novelty, and indie or popularity signals.
  - Added a wildcard lane for global-language standouts and hidden gems, then mixed those picks into the main set without overwhelming the core recommendations.
  - Expanded TMDB metadata, seed profiling, contextual weights, and interleaving so latest-watched and change-of-taste runs can rank titles differently.
- Netflix import reliability:
  - Batches Netflix CSV persistence before queueing follow-up processing so larger imports stop hammering SQLite one row at a time.
  - Preserves duplicate detection while falling back safely if a concurrent insert races the batch write.
  - Returns a friendlier import error in the UI instead of surfacing raw proxy HTML when an upstream timeout page is encountered.
- Fresh Out Of The Oven:
  - Fresh Out Of The Oven now supports TV premieres, not just movies.
- Rotten Tomatoes Upcoming Movies:
  - Adds a new Task Manager job that scrapes fixed Rotten Tomatoes upcoming and newest movie pages.
  - Deduplicates discovered titles, applies conservative title-and-year matching, and only routes safe matches onward.
  - Can send matched movies directly to Radarr or, when enabled, route them through Seerr instead.
  - Reports include discovery, routing, and skip details so you can see exactly what happened during the run.
- Durable repeat-watch dedupe for Plex auto-runs:
  - Based on your recently watched and Change of Taste now remember successful auto-runs per Plex user, library, and exact movie or episode.
  - Repeat scrobbles of the same item are skipped as already processed instead of re-running the same automation again.
  - The same durable dedupe applies across Plex polling and the existing Immaculate Taste webhook trigger so both paths stay aligned.
  - Manual and scheduled runs still work normally, and only new successful auto-runs start building this dedupe history.


1.7.6
---

- What's new since 1.7.5:
- Plex Watch History Import:
  - Fetches watched movies and TV shows directly from your Plex server library sections.
  - Classifies matched titles via TMDB and uses them as seeds for similar and change-of-taste recommendations.
  - Creates per-user Plex collections ("Plex History Picks" and "Plex History: Change of Taste") with the top results.
  - Available during onboarding and on demand from the Task Manager.
  - Job reports include a seed titles section showing exactly which history titles were matched and used.
- Netflix Watch History CSV Import:
  - Upload a Netflix viewing-history CSV to import watched titles into Immaculaterr.
  - Titles are classified via TMDB and used as seeds for similar and change-of-taste recommendation generation.
  - Results sync to per-user Plex collections just like the Plex history import.
  - Available during onboarding and as a standalone task in the Task Manager.
  - Import validation is stricter and follow-up reports keep the source and seed-title context intact.
- Watched-status-aware collection ordering:
  - Collection items you have already watched are pushed to the end so unwatched titles surface first.
  - Remaining items are grouped into TMDB rating tiers with a shuffle inside each tier for variety.
  - Recent-release titles get a dedicated slot near the top of collections.
  - Ordering logic is shared across Immaculate Taste refresher, Observatory, collection resync, and watched-collections refresher.
- Global job queue, Rewind, and recovery:
  - All jobs now run through one persisted FIFO queue shared across manual, scheduled, webhook, and polling triggers.
  - Queued runs survive restarts, stale workers are recovered automatically, and duplicate auto-runs are skipped cleanly instead of colliding.
  - The queue now enforces a 1-minute cooldown between runs plus global and per-job backlog caps to protect Plex and upstream services.
  - Rewind now shows live pending and running work with queued timestamps, ETA, blocked reason, delayed-run hints, and cancelled status.
- Reports, audit trail, and bug fixes:
  - Job detail pages now distinguish queued time from actual execution start time for clearer troubleshooting.
  - Rewind can clear terminal history without removing pending or running queue items.
  - Immaculate Taste profile actions are now recorded in Rewind for auditability.
  - Job reports continue to include a "Seed Titles" section listing every movie and TV show used as a recommendation seed.
  - Fixed a bug where Plex history import collections were incorrectly named "Netflix Import" instead of "Plex History".


1.7.5
---

- What's new since 1.7.1:
- Security hardening:
  - CSRF protection strengthened: state-changing requests without an Origin header now require an X-Requested-With header; the web frontend sends it automatically on all requests.
  - Expired sessions are automatically purged from the database every hour.
  - Credential envelope RSA key is auto-generated on first startup and persisted to APP_DATA_DIR with owner-only file permissions (chmod 600).
  - Plex webhook secret is auto-generated when PLEX_WEBHOOK_SECRET is not set and persisted to APP_DATA_DIR; retrievable via authenticated GET /api/webhooks/secret.
  - API production builds no longer emit source maps.
  - Vite dev server allowedHosts restricted to localhost, 127.0.0.1, and .local by default.
  - Content Security Policy tightened: font-src and connect-src restricted to 'self' only.
  - Google Fonts (Michroma, Montserrat) self-hosted as local WOFF2 files, removing external CDN dependency.
  - Authentication lockout state persisted to SQLite so lockouts survive server restarts; stale entries purged hourly.
  - Global ValidationPipe with whitelist and forbidNonWhitelisted enforces typed DTOs on all controller request bodies.
  - Timing-safe comparison used for debugger token verification.
  - Added .env.example files documenting security-relevant environment variables for API and Docker deployments.
- Profile-aware recommendation filtering:
  - TMDB recommendations are validated against each profile's genre and language include/exclude rules before points are applied.
  - Filtering uses existing TMDB detail responses so there are no additional API requests per recommendation.
  - Profiles configured for specific genres no longer receive unrelated titles that would dilute the collection.
- Session lifetime and API rate limiting:
  - Session expiration extended from 24 hours to 30 days with a rolling window that resets on each authenticated request.
  - Global API rate limit (120 requests per 60 seconds per IP) protects all endpoints.
  - Per-route throttles on auth, password change, and Plex webhook endpoints add additional safeguards.
  - Webhook payload deduplication cache prevents duplicate processing within a 30-second window.
- Unified collection hub order:
  - Webhook-triggered and Immaculate Taste refresher jobs now include Fresh Out Of The Oven in the movie hub order.
  - Fresh Out visibility (Home for admin, Shared Home for shared users) is centrally enforced regardless of which job triggers pinning.
  - Previously Fresh Out could be displaced until its own nightly job ran; now all pinning events assert the correct 4-position order.
- Secrets and Overseerr compatibility:
  - Vault page falls back to plaintext when WebCrypto is not available, fixing blank-state issues in certain Docker or non-HTTPS setups.
  - Overseerr setup wizard now supports plaintext authentication alongside encrypted credential flow.
- Migration repair and dependency updates:
  - Migration repair script logs diagnostics for blocked deploys and reconciles stuck migration rows so Prisma can rerun them safely.
  - Updated fast-xml-parser, file-type, and flatted to patched versions addressing upstream security advisories.


1.7.1
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
  - Based on your recently watched (auto-refreshes for newly completed movies/episodes)
  - Change of Taste (auto-refreshes for newly completed movies/episodes)
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
