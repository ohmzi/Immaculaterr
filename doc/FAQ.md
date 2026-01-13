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
  - [How can I run a job manually?](#how-can-i-run-a-job-manually)
  - [What is the difference between the Collection job and the Refresher job?](#what-is-the-difference-between-the-collection-job-and-the-refresher-job)
- [Collections & recommendations](#collections--recommendations)
  - [What Plex collections does the app create?](#what-plex-collections-does-the-app-create)
  - [What’s the difference between Immaculate Taste and Based on Latest Watched?](#whats-the-difference-between-immaculate-taste-and-based-on-latest-watched)
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
- [Radarr / Sonarr](#radarr--sonarr)
  - [What does Fetch Missing items actually do?](#what-does-fetch-missing-items-actually-do)
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
  - [Immaculaterr can’t reach Plex/Radarr/Sonarr — what URL should I use from Docker?](#immaculaterr-cant-reach-plexradarrsonarr--what-url-should-i-use-from-docker)
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

It does not download media by itself—it can optionally send missing titles to Radarr/Sonarr, which do the downloading.

### What are the three main pages I need to understand?

- Vault: connect services (Plex, Radarr/Sonarr, TMDB, optional Google/OpenAI).
- Command Center: tune how the app behaves (defaults and dials).
- Task Manager: run jobs manually, and enable/disable Auto-Run.

### How do I do first-time setup?

1. Create your admin login when prompted.
2. Go to Vault and connect Plex (and TMDB at minimum for best results).
3. Optionally connect Radarr/Sonarr (only if you want “Fetch Missing items” behavior).
4. Go to Task Manager and enable Auto-Run for the jobs you want.

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

### How can I run a job manually?

Go to Task Manager, open the job card, and press Run now.

Some jobs ask for a seed (title/year/media type). Others run directly with no input.

### What is the difference between the Collection job and the Refresher job?

Collection jobs generate new suggestions based on a seed (what you watched), then rebuild Plex collections.

Refresher jobs revisit the saved dataset, move items from pending → active when they appear in Plex, shuffle active items, and rebuild collections cleanly.

## Collections & recommendations

### What Plex collections does the app create?

- Inspired by your Immaculate Taste (Movies and TV)
- Based on your recently watched movie/show
- Change of Taste

### What’s the difference between Immaculate Taste and Based on Latest Watched?

Immaculate Taste is a longer-lived “taste profile” collection that refreshes over time.

Based on Latest Watched is more “right now”: it uses your recent watch as a seed, generates suggestions, tracks pending/active items, and refreshes as titles become available.

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

If “Fetch Missing items” is enabled for that job, Immaculaterr can optionally send the missing items to Radarr/Sonarr.

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

### What do swipes do, and can I use keyboard shortcuts?

- Swipe right: approve (in approval mode) or keep (in review mode)
- Swipe left: reject/remove that suggestion
- Undo: restores your last swipe
- Desktop: use ← and → to swipe the top card

### Why does Observatory say there are no suggestions for my library?

It usually means the collection job hasn’t generated suggestions yet for that library and media type.

Please continue using Plex and let suggestions build up, or run the collection task manually from Task Manager for that media type to generate suggestions.

## Radarr / Sonarr

### What does Fetch Missing items actually do?

It allows certain collection jobs to send missing recommendations to Radarr (movies) or Sonarr (TV) so your downloader stack can grab them. If disabled, the app will still track pending items but won’t send anything to ARR.

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

### Can I rotate the master key?

You can, but anything encrypted with the old key won’t decrypt with the new one. The safe rotation workflow is: rotate key, then re-enter secrets so they’re re-encrypted.

## Troubleshooting

### I can’t log in / I keep getting logged out — what do I check?

- Cookie/security settings (HTTP vs HTTPS deployments)
- Reverse proxy headers (X-Forwarded-Proto) if applicable
- Browser blocking cookies (private browsing, strict settings, etc.)

### Immaculaterr can’t reach Plex/Radarr/Sonarr — what URL should I use from Docker?

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

