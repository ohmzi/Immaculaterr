Features
===

Everything Immaculaterr does, in detail. The [README](../README.md) has the short version, and the [FAQ](FAQ.md) answers how each page and task behaves.

[← Back to README](../README.md)

- **Watches Plex activity and reacts automatically**
  - Finish a movie or episode, and Immaculaterr can turn that watch into fresh collections and great new recommendations right away.
  - It builds rows around what you actually watch and pins them on home screen, making your home screen feels more curated and personal, a bit like your own Netflix.
  - Off-peak schedules keep those rows fresh with background refresh, discovery, cleanup, and maintenance.
  - Bingeing does not spam you: once a show has triggered an auto-run, later episodes of that same show are skipped rather than rebuilding the same collections again — and the skip is recorded so you can see why.

- **Creates managed Plex collections**
  - `Based on your recently watched Movie` and `Based on your recently watched Show`
  - `Change of Movie Taste` and `Change of Show Taste`
  - `Inspired by your Immaculate Taste in Movies` and `Inspired by your Immaculate Taste in Shows`
  - `Fresh Out Of The Oven` and `Fresh Out Of The Oven Show`
  - `Netflix Import Picks` and `Netflix Import: Change of Taste`
  - `Plex History Picks` and `Plex History: Change of Taste`
  - Immaculate Taste profiles can also create extra custom-named collections.

- **Lets you split Immaculate Taste into multiple profiles**
  - Give each profile its own users, media type, filters, collection names, and download route.
  - Use genre and audio-language filters to build focused lanes like animation, family, or specific-language picks.

- **Keeps recommendations personal for each Plex user**
  - Each monitored viewer gets separate rows and separate watch history.
  - Managed rows are pinned to the Plex surfaces that viewer can actually see.

- **Uses a flexible recommendation engine**
  - TMDB is the main source.
  - Google and OpenAI are optional helpers for widening or refining results.
  - You can tune the mix between titles available now and future releases.

- **Sends missing titles where you want them**
  - Send directly to Radarr and Sonarr, or route through Seerr on a per-task basis.
  - Turn on `Approval required from Observatory` and nothing is sent until you have said yes to it yourself.

- **Observatory: swipe through suggestions before they reach Plex**
  - A card deck for judging recommendations one title at a time, with the poster, the rating, and its score in front of you before you decide.
  - Two passes per library. First the approvals: swipe right to **approve** a missing title for Radarr/Sonarr, left to **reject** it. Then the review pass: swipe right to **keep** a title in the collection, left to **remove** it.
  - Swipe on a phone, drag on a desktop, or use the buttons — arrow keys work too, and `Z` undoes the last card when you change your mind.
  - Decisions are saved as you make them rather than piling up behind a Save button, and the deck tells you how many cards are left.
  - Separate decks for `Immaculate Taste` and `Based on Latest Watched`, each split by library and by movies vs. shows, so the two never get tangled.
  - The sync to Plex runs in the background, so a big library finishes on its own time instead of stalling the page.

- **Includes discovery and maintenance jobs**
  - `Fresh Out Of The Oven` builds recent-release movie and TV rows for titles a user has not watched yet.
  - `TMDB Upcoming Movies` finds upcoming movies with filter sets and routes matches to Radarr or Seerr.
  - `Rotten Tomatoes Upcoming Movies + TV Shows` scrapes fixed Rotten Tomatoes movie and TV pages, uses saved Movies and TV toggles with separate Movie Top 20 and TV Top 10 counts, and lets Run Now use those saved settings directly.
  - Cleanup and ARR sync jobs help keep Plex, Radarr, and Sonarr tidy after imports and downloads, including season-aware Sonarr monitoring cleanup.
  - `Confirm Monitored` only unmonitors a movie once Plex can actually play it *and* Radarr confirms the file is there, so a missing or half-finished download is never mistaken for a finished one.

- **Cutting Room: prunes the media nobody will ever watch**
  - Scans your selected Plex libraries plus Radarr/Sonarr (and Tautulli when connected) and scores every item on real watch history, time in library, ratings with vote confidence (popular and highly-regarded titles are never counted as "low rated"), and who requested it.
  - A six-step wizard: pick factors and protections, choose libraries, scan once, tune "how low a bar" instantly, set a space target with auto-select, review every candidate with plain-language reason chips, then prune with a typed confirmation.
  - Pruning deletes files through Radarr/Sonarr but keeps each entry unmonitored and tagged `deleted-by-immaculaterr`; Pruned History offers one-click Restore that re-monitors and re-downloads.
  - Watchlists, continue-watching, recent requests, your own high-rated titles, and Immaculaterr's managed collections are always protected; a full dry-run mode rehearses everything without touching a file.
  - Companion tabs: a Wanted List cleaner (unmonitor never-downloaded entries without touching files), a Duplicates cleaner (keep one version per movie), and a Large Files replacer (delete oversized movie/episode files, re-monitor exactly the affected items, tag them `size-reduction`, switch them to auto-created size-capped quality profiles — movies ~10 GB max, episodes 3 GB max preferring 1–2 GB — and re-search for smaller copies automatically) — also available as an exclusive "Oversized files" card inside the wizard.

- **Supports history imports from day one**
  - Netflix CSV import creates dedicated Netflix import collections and feeds the main recommendation system.
  - Plex watch-history import does the same without needing a CSV.

- **Supports custom posters for managed collections**
  - Upload and manage poster overrides in Command Center.
  - Posters are stored so they survive restarts and updates.

- **Keeps a shared queue and clear run history**
  - Manual runs, schedules, Plex webhooks, and Plex polling all go through one persisted FIFO queue.
  - Rewind shows queued work, live progress, reports, logs, and run history.
  - Pause the whole queue when you want the server left alone, cancel anything still waiting, and resume when you are ready.
  - Runs fail loudly and honestly: a failed scrape, an unreachable Radarr/Sonarr, or a run where every item failed is reported as a failure with readable diagnostics, instead of quietly reporting zero.
  - Logs have a live tail you can pause, a refresh rate you can set, per-line copy, and a download button.

- **Includes built-in admin sign-in and recovery**
  - Create the admin login during setup.
  - Password recovery uses security questions.

- **Connects to the rest of your stack**
  - Required: Plex. For fetching what is missing: Radarr, Sonarr, or Seerr.
  - For metadata and discovery: TMDB, with Google and OpenAI as optional helpers.
  - Optional: Tautulli, which gives Cutting Room richer watch history than Plex alone. It has its own step in the setup wizard and a testable card in the Vault — and everything still works without it.

- **Feels quick to live in**
  - Search with `Ctrl/Cmd+K` (or `/`) to jump to any page, and it finds FAQ answers too.
  - Filters and tabs are remembered between visits, so you come back to where you left off.
  - Times read as "4 days ago", with the exact timestamp on hover.
  - Full mobile support, including pull-to-refresh on Rewind and Logs — and if you prefer less movement, reduced-motion is respected throughout.
  - Pages load as you visit them instead of as one large bundle, so the first screen arrives quickly.

- **Puts management in the app**
  - Use Vault for integrations, Task Manager for jobs, Rewind for reports, and Command Center for resets, posters, user monitoring, and request cleanup.

Integrations
---

| Service | Required | What it is used for |
| --- | :---: | --- |
| **Plex** | ✅ | The library Immaculaterr reads, builds collections in, and pins rows on. |
| **TMDB** | ✅ | Primary metadata and candidate source for recommendations. |
| **Radarr** | ➖ | Fetching missing movies. |
| **Sonarr** | ➖ | Fetching missing shows. |
| **Seerr** | ➖ | Alternative, centralized request route instead of direct ARR sends. |
| **Tautulli** | ⬜ | Richer watch history for Cutting Room than Plex alone. Everything still works without it. |
| **OpenAI** | ⬜ | Optional helper for widening or refining recommendation results. |
| **Google** | ⬜ | Optional helper for widening or refining recommendation results. |

✅ required · ➖ at least one needed to fetch missing titles · ⬜ fully optional
