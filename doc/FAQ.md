# FAQ

This app can feel like a lot at first. This FAQ is designed to answer the “what is this doing?” questions quickly.

## Table of contents

- [Getting started](#getting-started)
  - [What is Immaculaterr?](#what-is-immaculaterr)
  - [What are the three main pages I need to understand?](#what-are-the-three-main-pages-i-need-to-understand)
  - [How do I do first-time setup?](#how-do-i-do-first-time-setup)
  - [What port does Immaculaterr use and how do I access it?](#what-port-does-immaculaterr-use-and-how-do-i-access-it)
- [Automation & triggers](#automation--triggers)
  - [What does Plex-Triggered Auto-Run mean?](#what-does-plex-triggered-auto-run-mean)
  - [When does Collection task trigger?](#when-does-collection-task-trigger)
  - [Why didn’t a job trigger even though I watched past the threshold?](#why-didnt-a-job-trigger-even-though-i-watched-past-the-threshold)
  - [How does Plex Library Selection affect auto-runs and manual runs?](#how-does-plex-library-selection-affect-auto-runs-and-manual-runs)
  - [How can I run a job manually?](#how-can-i-run-a-job-manually)
  - [What is the difference between the Collection job and the Refresher job?](#what-is-the-difference-between-the-collection-job-and-the-refresher-job)
- [Collections & recommendations](#collections--recommendations)
  - [What Plex collections does the app create?](#what-plex-collections-does-the-app-create)
  - [How do per-viewer collections and Plex pin locations work?](#how-do-per-viewer-collections-and-plex-pin-locations-work)
  - [What’s the difference between Immaculate Taste and Based on Latest Watched?](#whats-the-difference-between-immaculate-taste-and-based-on-latest-watched)
  - [How does the Immaculate Taste collection work?](#how-does-the-immaculate-taste-collection-work)
  - [How do Immaculate Taste points work, and how do they decay?](#how-do-immaculate-taste-points-work-and-how-do-they-decay)
  - [What is Change of Taste and how is it chosen?](#what-is-change-of-taste-and-how-is-it-chosen)
  - [How are recommendation titles generated?](#how-are-recommendation-titles-generated)
  - [What does the ratio of future releases vs current releases do?](#what-does-the-ratio-of-future-releases-vs-current-releases-do)
  - [Why do I see not enabled or skipped?](#why-do-i-see-not-enabled-or-skipped)
  - [What happens when a recommended title isn’t in Plex?](#what-happens-when-a-recommended-title-isnt-in-plex)
  - [How does the refresher move items from pending to active?](#how-does-the-refresher-move-items-from-pending-to-active)
  - [Why does the app recreate Plex collections instead of editing them in place?](#why-does-the-app-recreate-plex-collections-instead-of-editing-them-in-place)
  - [How does poster artwork work for collections? Can I customize posters?](#how-does-poster-artwork-work-for-collections-can-i-customize-posters)
- [Observatory (swipe review)](#observatory-swipe-review)
  - [What is the Observatory page?](#what-is-the-observatory-page)
  - [How do I require approval before sending anything to Radarr/Sonarr?](#how-do-i-require-approval-before-sending-anything-to-radarrsonarr)
  - [What do swipes do, and can I use keyboard shortcuts?](#what-do-swipes-do-and-can-i-use-keyboard-shortcuts)
  - [Why does Observatory say there are no suggestions for my library?](#why-does-observatory-say-there-are-no-suggestions-for-my-library)
- [Radarr / Sonarr / Overseerr](#radarr--sonarr--overseerr)
  - [What does Fetch Missing items actually do?](#what-does-fetch-missing-items-actually-do)
  - [How do I set up Overseerr mode in simple steps?](#how-do-i-set-up-overseerr-mode-in-simple-steps)
  - [What changes when I turn on Route missing items via Overseerr?](#what-changes-when-i-turn-on-route-missing-items-via-overseerr)
  - [What is the difference between in-app approval mode and Overseerr mode?](#what-is-the-difference-between-in-app-approval-mode-and-overseerr-mode)
  - [How do I clear all Overseerr requests from Immaculaterr?](#how-do-i-clear-all-overseerr-requests-from-immaculaterr)
  - [If I disable Radarr/Sonarr toggles, what changes?](#if-i-disable-radarrsonarr-toggles-what-changes)
  - [Will it ever delete movies/shows?](#will-it-ever-delete-moviesshows)
  - [What happens during Cleanup after adding new content?](#what-happens-during-cleanup-after-adding-new-content)
  - [How are duplicates handled?](#how-are-duplicates-handled)
- [Updates & versions](#updates--versions)
  - [How does the app check for updates?](#how-does-the-app-check-for-updates)
  - [Why does it say Update available? What should I do?](#why-does-it-say-update-available-what-should-i-do)
  - [Where can I see the current version and version history?](#where-can-i-see-the-current-version-and-version-history)
  - [Why isn’t update checking working?](#why-isnt-update-checking-working)
- [Security & backups](#security--backups)
  - [What is APP_MASTER_KEY and why is it required?](#what-is-app_master_key-and-why-is-it-required)
  - [Where should I store the master key (env var vs secret file)?](#where-should-i-store-the-master-key-env-var-vs-secret-file)
  - [What happens if I lose the master key?](#what-happens-if-i-lose-the-master-key)
  - [What should I back up to restore safely?](#what-should-i-back-up-to-restore-safely)
  - [Can I rotate the master key?](#can-i-rotate-the-master-key)
- [Troubleshooting](#troubleshooting)
  - [I can’t log in / I keep getting logged out — what do I check?](#i-cant-log-in--i-keep-getting-logged-out--what-do-i-check)
  - [Immaculaterr can’t reach Plex/Radarr/Sonarr/Overseerr — what URL should I use from Docker?](#immaculaterr-cant-reach-plexradarrsonarroverseerr--what-url-should-i-use-from-docker)
  - [TMDB requests fail — what’s required and where do I configure it?](#tmdb-requests-fail--whats-required-and-where-do-i-configure-it)
  - [A job ran but the report looks empty — what does that mean?](#a-job-ran-but-the-report-looks-empty--what-does-that-mean)
  - [Collections created but no poster shows — why?](#collections-created-but-no-poster-shows--why)
  - [How do I view logs and job history?](#how-do-i-view-logs-and-job-history)
- [Glossary](#glossary)
  - [Auto-Run](#auto-run)
  - [Plex-Triggered](#plex-triggered)
  - [Scheduled](#scheduled)
  - [Seed](#seed)
  - [Pending](#pending)
  - [Active](#active)
  - [Refresher](#refresher)

## Getting started

### What is Immaculaterr?

Immaculaterr is a Plex “autopilot” that watches your Plex activity, generates curated recommendation collections, and runs a few safety-focused cleanup jobs so your library stays tidy.

It does not download media by itself—it can optionally send missing titles to Radarr/Sonarr or Overseerr, which handle the request/download workflows.

### What are the three main pages I need to understand?

- Vault: connect services (Plex, Radarr/Sonarr/Overseerr, TMDB, optional Google/OpenAI).
- Command Center: tune how the app behaves (defaults and dials).
- Task Manager: run jobs manually, and enable/disable Auto-Run.

### How do I do first-time setup?

1. Create your admin login when prompted.
2. Go to Vault and connect Plex (and TMDB at minimum for best results).
3. Optionally connect Radarr/Sonarr and/or Overseerr (only if you want “Fetch Missing items” behavior).
4. In Task Manager, choose your missing-item route per task card: direct ARR route or Overseerr route.
5. Go to Task Manager and enable Auto-Run for the jobs you want.

### What port does Immaculaterr use and how do I access it?

By default, it serves the Web UI and API on port `5454`.

Open: `http://<server-ip>:5454/`

## Automation & triggers

### What does Plex-Triggered Auto-Run mean?

When Auto-Run is enabled for a Plex-triggered job, Immaculaterr polls Plex and automatically starts the job when the trigger condition is met (for example, “watched percentage reached”).

You can still run the job manually any time from Task Manager.

### When does Collection task trigger?

By default, it triggers when Plex polling detects you’ve watched roughly 70% of the item.

### Why didn’t a job trigger even though I watched past the threshold?

- Auto-Run is off for that job in Task Manager.
- Plex polling is disabled (or not reaching Plex).
- The item is too short (minimum duration rules can apply).
- The job was recently triggered and deduped to prevent repeated runs.
- The seed came from a Plex library you excluded in **Command Center → Plex Library Selection**.

### How does Plex Library Selection affect auto-runs and manual runs?

After Plex auth in onboarding, there is a dedicated **Plex Libraries** step.

- Immaculaterr lists eligible movie/show libraries and preselects them by default.
- You can deselect libraries you do not want included, but at least 1 library must stay selected.
- You can change this later from **Command Center → Plex Library Selection**.
- The model is exclusion-based (`excludedSectionKeys`), so new Plex libraries are auto-included unless you explicitly exclude them.

How this affects runtime behavior:

- **Auto triggers** (Plex polling + webhook scrobble): if the detected seed library is excluded, the run is skipped with reason `library_excluded`.
- **Collection jobs** (manual + auto): candidate libraries are filtered first by your selection.
  - If a seed resolves to an excluded library, the run is skipped (not failed).
  - If no selected libraries remain for that media type, the run is skipped with `no_selected_movie_libraries` or `no_selected_tv_libraries`.
- **Refresher jobs**: both targeted and sweep runs only operate on selected libraries. If nothing is eligible, you get a skipped summary instead of an error.

Why this helps: it prevents unintended writes to libraries you want isolated (kids/test/archive), keeps behavior consistent across setup and run modes, and makes skip reasons explicit in reports.

### How can I run a job manually?

Go to Task Manager, open the job card, and press Run now.

Some jobs ask for a seed (title/year/media type). Others run directly with no input.

### What is the difference between the Collection job and the Refresher job?

Collection jobs generate new suggestions based on a seed (what you watched), then rebuild Plex collections.

Refresher jobs revisit the saved dataset, move items from pending → active when they appear in Plex, shuffle active items, and rebuild collections cleanly.

Scope behavior:

- Collection-triggered/chained refreshes stay scoped to the triggering viewer + library.
- Standalone refresher runs (scheduled, or manual Run now without a scope) sweep all eligible viewers/libraries, using deterministic user ordering with admin processed last.

## Collections & recommendations

### What Plex collections does the app create?

- Inspired by your Immaculate Taste (Movies and TV)
- Based on your recently watched movie/show
- Change of Taste

### How do per-viewer collections and Plex pin locations work?

Each viewer now gets their own curated collection rows for Movies and TV. The viewer name is appended to the row title, for example: `Based on your recently watched show (ohmz_i)`.

Under the hood, recommendation datasets are stored per viewer and per library. That keeps one viewer’s watch history from influencing another viewer’s recommendations.

Pinning rules are role-based:

- Admin viewer rows are pinned to **Library Recommended** and **Home**.
- Non-admin viewer rows are pinned to **Friends Home**.

Why non-admin rows use Friends Home:

- With current Plex limits in this workflow, shared viewers cannot reliably pin these server-managed rows to their own Home.
- The fallback is to pin viewer-specific rows at the top of **Friends Home**.
- Tradeoff: other viewers may see those rows there, but the recommendations inside each row still come from the owning viewer’s watch activity.

Curated row order is fixed everywhere (viewer suffix ignored):

1. Based on your recently watched ...
2. Change of Taste
3. Inspired by your Immaculate Taste

Row matching/order ignores trailing viewer suffixes, so priority stays deterministic across users.

Also included with this update:

- User-aware Command Center reset controls and Plex-user dataset management.
- Expanded debugger/logging coverage and improved job reporting with clearer user/media context.

### What’s the difference between Immaculate Taste and Based on Latest Watched?

Immaculate Taste is a longer-lived “taste profile” collection that refreshes over time.

Based on Latest Watched is more “right now”: it uses your recent watch as a seed, generates suggestions, tracks pending/active items, and refreshes as titles become available.

### How does the Immaculate Taste collection work?

Immaculate Taste is a **per-library** dataset that grows and evolves as you watch things:

- When the **Immaculate Taste Collection** job runs (typically after you finish a movie/show if the automation toggle is enabled), it generates new “taste” suggestions and updates a stored dataset for that Plex library.
- Each suggested title is tracked as either:
  - **Active**: it exists in Plex right now (eligible to be placed into the Plex collection), or
  - **Pending**: it’s not in Plex yet (tracked for later activation).
- The **Immaculate Taste Refresher** job later revisits that dataset, activates pending titles that have appeared in Plex, and rebuilds the Plex collection.

One important detail: the **ordering** inside the Plex collection is not “highest points first”. For variety, the refresher shuffles items using TMDB rating tiers (high/mid/low) so you don’t just get a monotonically sorted list every time.

### How do Immaculate Taste points work, and how do they decay?

Each active title has an integer **points** value that acts like a “freshness meter”.

- **Max points**: when a title is (re)suggested and it’s **active**, its points are set to `immaculateTaste.maxPoints` (default **50**).
- **Pending titles**: when a title is suggested but **not in Plex**, it’s saved as **pending** with **0** points (so it doesn’t show up until it exists in Plex).
- **Activation**: when a pending title later appears in Plex, the refresher marks it **active** and assigns points (currently **50** on activation).
- **Decay**: on each points-update run, any **active** title that was **not suggested this run** loses **1 point**.
- **Removal**: once an active title’s points reach **0**, it is removed from the active dataset (pending items are preserved).

Practical takeaway: with the default max of **50**, a title that never gets re-suggested will typically stick around for roughly **50 future Immaculate Taste updates** before it falls out.

### What is Change of Taste and how is it chosen?

It’s designed to intentionally vary from your “similar” recommendations—think adjacent genres, different eras, or a deliberate curveball—so your feed isn’t all the same vibe.

### How are recommendation titles generated?

Recommendations always start with TMDB (it builds a pool of candidates similar to the seed). What happens next depends on what you configured in Vault:

#### Variant 1: TMDB only

- TMDB finds the seed and builds candidate pools (released / upcoming / unknown).
- The “future vs current” ratio dial is applied to pick a mix (see below).
- Final titles come from TMDB’s pool selection.

#### Variant 2: TMDB + OpenAI

- TMDB still builds the candidate pools first.
- OpenAI then curates the final list from TMDB candidates (better “taste” and variety).
- The final list is still constrained by the released/upcoming mix you set.

#### Variant 3: TMDB + Google + OpenAI

- TMDB builds the candidate pools.
- Google search is used as a discovery booster (web context) to widen suggestions and add extra candidates.
- OpenAI uses both TMDB candidates and the web context to curate the final list.

The job reports include a per-service breakdown (what each service suggested) plus the final “Generated” list.

### What does the ratio of future releases vs current releases do?

This dial lives in Command Center → Recommendations. It controls how many suggestions are:

- **Current releases**: already released and typically available to watch now
- **Future releases**: upcoming titles that may not be released yet

Under the hood it sets `recommendations.upcomingPercent` (default 25%). The system enforces that **released stays at least 25%**, so upcoming is effectively capped (max 75%).

### Why do I see not enabled or skipped?

Those cards are always shown for transparency:

- “Not enabled” means you didn’t configure that integration.
- “Skipped” means the job strategy didn’t need that service for this run.

### What happens when a recommended title isn’t in Plex?

It’s recorded as pending. Pending items can later become active once they appear in Plex.

If “Fetch Missing items” is enabled for that job, Immaculaterr can optionally send missing items to Radarr/Sonarr directly, or to Overseerr if Overseerr mode is enabled for that task.

### How does the refresher move items from pending to active?

On refresh, Immaculaterr checks pending titles against Plex. If a title is now found in Plex, it’s marked active and becomes eligible for the collection rebuild.

### Why does the app recreate Plex collections instead of editing them in place?

Plex can keep old ordering even after remove/re-add operations. Recreating the collection is the most reliable way to guarantee ordering and to keep collections consistent across refreshes.

### How does poster artwork work for collections? Can I customize posters?

When collections are created/recreated, the app applies shipped poster artwork by matching collection name → poster file.

Advanced: you can replace the poster files under `apps/web/src/assets/collection_artwork/posters` (or adjust the mapping in the backend) to customize.

## Observatory (swipe review)

### What is the Observatory page?

Observatory is a swipe-based review deck for the Immaculate Taste dataset. It lets you approve download requests (optional), and curate your suggestions before/while they land in Plex collections.

### How do I require approval before sending anything to Radarr/Sonarr?

In Task Manager → Immaculate Taste Collection, turn on **Approval required from Observatory**.

When enabled, Immaculaterr will not send missing titles to Radarr/Sonarr until you **swipe right** on them in Observatory.

Note: this applies to direct ARR mode. If you enable Overseerr routing for that task, Observatory approval is automatically disabled for that task.

### What do swipes do, and can I use keyboard shortcuts?

- Swipe right: approve (in approval mode) or keep (in review mode)
- Swipe left: reject/remove that suggestion. This adds it to your rejected list, so it won’t be suggested again.
- Undo: restores your last swipe
- Desktop: use ← and → to swipe the top card

You can reset the rejected list from **Command Center → Reset Rejected List**.

### What does “Reset Immaculate Taste Collection” do?

It deletes the Immaculate Taste Plex collection for the selected library and clears the saved dataset for that library (pending/active tracking).

After reset, run **Immaculate Taste Collection** again (or let it auto-run) to rebuild suggestions and recreate the Plex collection.

### Why does Observatory say there are no suggestions for my library?

It usually means the collection job hasn’t generated suggestions yet for that library and media type.

Please continue using Plex and let suggestions build up, or run the collection task manually from Task Manager for that media type to generate suggestions.

## Radarr / Sonarr / Overseerr

### What does Fetch Missing items actually do?

It allows collection jobs to push missing recommendations out of Immaculaterr. You can route them directly to Radarr/Sonarr, or route them to Overseerr. If disabled, the app still tracks pending items but does not send requests anywhere.

### How do I set up Overseerr mode in simple steps?

1. Go to **Vault** and set Overseerr URL + API key.
2. Enable Overseerr in Vault and run the test.
3. Go to **Task Manager** and turn on **Route missing items via Overseerr** for each task you want (Immaculate Taste and/or Based on Latest Watched).
4. Run the task. New missing titles from that task will be requested in Overseerr.

### What changes when I turn on Route missing items via Overseerr?

- Missing titles from that task are sent to Overseerr instead of direct ARR sends.
- Direct Radarr/Sonarr toggles for that task are turned off.
- Approval required from Observatory is turned off for that task.
- For Immaculate Taste, **Start search immediately** is also turned off.
- Suggestions, pending/active tracking, and Plex collection updates still continue as normal.

### What is the difference between in-app approval mode and Overseerr mode?

- **In-app approval mode**: you approve in Observatory, then Immaculaterr sends approved items directly to Radarr/Sonarr.
- **Overseerr mode**: Immaculaterr sends missing items to Overseerr, and Overseerr becomes the place where request workflow is handled.

Use one flow per task card. If Overseerr mode is on, Immaculaterr’s Observatory approval flow for sending is disabled for that task.

### How do I clear all Overseerr requests from Immaculaterr?

Go to **Command Center** and use **Reset Overseerr Requests**.

You’ll get a confirmation dialog. Once confirmed, Immaculaterr asks Overseerr to delete all requests regardless of status.

This only clears Overseerr requests. It does not delete your existing Plex media files.

### If I disable Radarr/Sonarr toggles, what changes?

The jobs stop making ARR add/search calls. Everything else (recommendations, Plex matching, pending/active dataset, collection rebuilds) continues to work.

### Will it ever delete movies/shows?

Immaculaterr does not delete your Plex media files. Some cleanup jobs may unmonitor duplicates in Radarr/Sonarr to reduce clutter, but they’re designed to be safety-first.

### What happens during Cleanup after adding new content?

It scans for duplicates across libraries and keeps the best one, then unmonitors duplicates in Radarr/Sonarr (with episode/season-aware rules for TV).

### How are duplicates handled?

- Duplicates are detected across libraries; the “best” one is kept.
- Movie duplicates can be unmonitored in Radarr.
- TV duplicates are handled carefully (single-episode duplicates can be unmonitored without nuking the whole show).

## Updates & versions

### How does the app check for updates?

The server checks the latest GitHub release and compares it to the running app version. The UI surfaces this in the Help menu and can toast when a newer version is available.

### Why does it say Update available? What should I do?

It means a newer release exists than what your container is currently running.

```bash
docker compose pull && docker compose up -d
```

### Where can I see the current version and version history?

In the Help menu: tap the Version button (and the Version History page will expand over time). You can also view releases on GitHub.

### Why isn’t update checking working?

- Update checks can be disabled via environment configuration.
- GitHub API rate limits can block checks.
- If you’re checking a private repo, you may need a GitHub token configured for update checks.

## Security & backups

### What is APP_MASTER_KEY and why is it required?

It’s the encryption key used to protect stored secrets at rest (for example, API tokens). It must be stable so the app can decrypt what it previously encrypted.

### Where should I store the master key (env var vs secret file)?

- Recommended: Docker secret file via `APP_MASTER_KEY_FILE`
- Also supported: environment variable `APP_MASTER_KEY` (64-char hex or base64 that decodes to 32 bytes)
- If you provide neither, the app generates a key file in the data directory

### What happens if I lose the master key?

The app won’t be able to decrypt previously saved secrets. You’ll need to reset/re-enter secrets (or reset the account) and store a new stable key going forward.

### What should I back up to restore safely?

- Your app data directory (Docker volume) including the SQLite database.
- Your master key (env var or key file), so encrypted secrets remain decryptable.
- Any deployment configuration (compose files/env values).
- By default, the container also writes a pre-migration SQLite snapshot before startup migrations under `/data/backups/pre-migrate`.
  - `DB_PRE_MIGRATE_BACKUP=true|false` (default `true`)
  - `DB_PRE_MIGRATE_BACKUP_KEEP=<count>` (default `10`)
  - `DB_PRE_MIGRATE_BACKUP_DIR=<path>` (default `/data/backups/pre-migrate`)
  - `DB_PRE_MIGRATE_BACKUP_STRICT=true|false` (default `false`, best-effort)

### Can I rotate the master key?

You can, but anything encrypted with the old key won’t decrypt with the new one. The safe rotation workflow is: rotate key, then re-enter secrets so they’re re-encrypted.

## Troubleshooting

### I can’t log in / I keep getting logged out — what do I check?

- Cookie/security settings (HTTP vs HTTPS deployments)
- Reverse proxy headers (X-Forwarded-Proto) if applicable
- Browser blocking cookies (private browsing, strict settings, etc.)

### Immaculaterr can’t reach Plex/Radarr/Sonarr/Overseerr — what URL should I use from Docker?

On Linux with host networking: `http://localhost:<port>`

On Docker Desktop: `http://host.docker.internal:<port>`

### TMDB requests fail — what’s required and where do I configure it?

Configure TMDB in Vault. If TMDB isn’t set up, recommendations may be incomplete or fail depending on the job strategy.

### A job ran but the report looks empty — what does that mean?

Usually it means there was nothing new to do (no new seed, no pending items became available, or collections were already up to date). Check the step-by-step breakdown and logs for details.

### Collections created but no poster shows — why?

- The container image may be outdated (rebuild/pull and restart).
- The collection name may not match the artwork mapping.
- Plex may take time to refresh metadata.

### How do I view logs and job history?

- Rewind: run history + job reports
- Logs: raw server log lines

## Glossary

### Auto-Run

A toggle that allows a job to run automatically when its trigger condition occurs.

### Plex-Triggered

Jobs that start based on Plex events detected by polling (watch threshold, new media, etc.).

### Scheduled

Jobs that run on a time schedule (daily/weekly/monthly/cron).

### Seed

The movie/show that triggers a run and is used to generate recommendations.

### Pending

A suggested title that is not in Plex yet (but may become available later).

### Active

A title that is in Plex and eligible to appear in a curated collection.

### Refresher

A job that revisits the saved dataset, activates newly-available items, shuffles, and rebuilds collections.
