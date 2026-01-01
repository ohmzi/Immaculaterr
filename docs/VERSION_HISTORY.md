# Version History

This document is the **complete changelog** for Tautulli Curated Plex Collection.

It is generated from **git tags** (`v1.0.0` → `v5.0.0`) plus the **current branch/HEAD** (used for the “5.2.0 (Current)” section).  
`v5.1.0` was not tagged, so the changelog pins **Version 5.1.0** to commit `edfda4b`.

For each version you’ll find:
- **Highlights** (what changed and why it matters)
- **Upgrade notes** (what you may need to change in config or behavior)
- **Git details** (commits + file-level diff from the previous version)

---

## Version 5.2.0 (Current)

- **Git ref**: `HEAD` (`f51c37e`, 2026-01-01)
- **Diff base**: `edfda4b..HEAD`

### Highlights (since v5.1.0)

- **Weekly health monitoring + email report**: parse `data/logs/` and send a weekly Gmail SMTP email with a clean status breakdown (plus JSON outputs for future dashboards).
- **Mobile-friendly report formatting**: HTML + plain-text fallback, dark-mode friendly styling, and short “What happened” excerpts for PARTIAL/FAILED runs.
- **Better cron coverage**: includes all `src/scripts/run_*.sh` runners + Tautulli-triggered `tautulli_main_*` logs, and flags missing runs.
- **Logging improvements**: ensured key runners reliably emit `FINAL_STATUS=... FINAL_EXIT_CODE=...` (and added missing `--log-file` support where needed).
- **Release polish**: aligned internal package versioning, scrubbed config template placeholders, and tightened gitignore rules to avoid committing runtime/IDE artifacts.

### Upgrade notes

- To enable weekly emails, configure `alerts.email` in `config/config.local.yaml` and schedule:
  - `python3 -m tautulli_curated.tools.weekly_health_report --since-days 7 --send-email`
- For best monitoring results, run cron scripts with `--log-file` so each run produces a timestamped log in `data/logs/`.

<details>
<summary><strong>Commits (edfda4b..HEAD)</strong></summary>

```text
f51c37e feat: Add weekly email health report and improve script logging
ea44577 feat: Improve monitoring, recommendations, and script robustness
```

</details>

<details>
<summary><strong>Files changed (edfda4b..HEAD)</strong></summary>

```text
M	.gitignore
M	config/config.yaml
M	docs/ERROR_HANDLING.md
M	docs/README.md
A	docs/VERSION_HISTORY.md
M	src/scripts/run_google_search_test.sh
M	src/scripts/run_immaculate_taste_refresher.sh
A	src/scripts/run_radarr_duplicate_cleaner.sh
M	src/scripts/run_radarr_monitor_confirm.sh
M	src/scripts/run_radarr_search_monitored.sh
M	src/scripts/run_recently_watched_collections_refresher.sh
M	src/scripts/run_sonarr_duplicate_cleaner.sh
M	src/scripts/run_sonarr_monitor_confirm.sh
M	src/scripts/run_sonarr_search_monitored.sh
M	src/tautulli_curated/helpers/chatgpt_utils.py
M	src/tautulli_curated/helpers/config_loader.py
M	src/tautulli_curated/helpers/google_search.py
M	src/tautulli_curated/helpers/immaculate_taste_refresher.py
A	src/tautulli_curated/helpers/log_health.py
M	src/tautulli_curated/helpers/plex_collection_manager.py
M	src/tautulli_curated/helpers/plex_duplicate_cleaner.py
M	src/tautulli_curated/helpers/radarr_monitor_confirm.py
M	src/tautulli_curated/helpers/recently_watched_collections_refresher.py
M	src/tautulli_curated/helpers/recommender.py
M	src/tautulli_curated/helpers/sonarr_duplicate_cleaner.py
M	src/tautulli_curated/main.py
A	src/tautulli_curated/tools/__init__.py
A	src/tautulli_curated/tools/weekly_health_report.py
M	tautulli_immaculate_taste_collection.py
```

</details>

---

## Version 5.1.0

- **Git ref**: `edfda4b` (2025-12-31)
- **Diff base**: `v5.0.0..edfda4b`

### Highlights (since v5.0.0)

- **Cron execution + logging hardening**: fixes common cron/PYTHONPATH/HOME issues and improves timestamped logs for troubleshooting.
- **Sonarr orchestration in main pipeline**: integrates Sonarr duplicate cleaning, monitor confirm, and “search monitored” steps into the main runner.
- **Plex UI improvements**: automates pinning curated collections as Home/Library recommendation rows.
- **Recommendations upgrades**: optional Google CSE → OpenAI context pipeline (with TMDb as mandatory fallback).

### Upgrade notes

- **TMDb is mandatory**: the pipeline relies on TMDb for metadata and fallback recommendations (especially when OpenAI/Google aren’t configured).
- **Optional services**:
  - **OpenAI** is optional (paid, but typically low cost for this workflow).
  - **Google CSE** is optional (free tier available; used only when OpenAI is enabled).

<details>
<summary><strong>Commits (v5.0.0..edfda4b)</strong></summary>

```text
edfda4b feat: Add Google Search context for OpenAI and refactor config
5969b1f feat: Automate pinning of curated collections to Plex Home
9e11814 chore: Update README image format from JPG to PNG
58df352 docs: Revamp README with comprehensive guides and visuals
bf08274 feat: Unmonitor entire shows in Sonarr
99e6d8d feat: Add safety check to verify all season episodes exist in Plex
4a76d00 docs: Remove artwork instruction files
2028d95 refactor: rename unmonitor module and add season watchlist removal
8e6bd9b Merge pull request #12 from ohmzi/feature/integrate-sonarr-scripts-into-main-pipeline
ebe2b98 Changes: - Add run_sonarr_duplicate_cleaner, run_sonarr_monitor_confirm_plex,   and run_sonarr_search_monitored config options - Create sonarr_search_monitored_episodes() function in sonarr_utils.py - Integrate Sonarr duplicate cleaner into main.py (Step 4) - Integrate Sonarr monitor confirm into main.py (Step 5) - Integrate Sonarr search monitored into main.py (Step 6) - Update config.yaml with new Sonarr script execution controls
72f52ed Merge pull request #11 from ohmzi/fix/cron-python-imports-and-logging
a8e6ed5 fix: Resolve cron execution issues and improve logging
```

</details>

<details>
<summary><strong>Files changed (v5.0.0..edfda4b)</strong></summary>

```text
M	.gitignore
D	assets/collection_artwork/PLACE_IMAGES_HERE.txt
D	assets/collection_artwork/README.md
M	config/config.yaml
M	docs/README.md
D	sample_run_pictures/plex_duplicate_delete_log.png
D	sample_run_pictures/plex_mobile_app_screenshot.jpg
A	sample_run_pictures/plex_mobile_app_screenshot.png
A	sample_run_pictures/plex_mobile_app_screenshot2.png
A	sample_run_pictures/plex_pc_screenshot.png
D	sample_run_pictures/radarr_unmonitor_log_2.png
A	src/scripts/run_google_search_test.sh
M	src/scripts/run_immaculate_taste_refresher.sh
M	src/scripts/run_radarr_monitor_confirm.sh
M	src/scripts/run_radarr_search_monitored.sh
M	src/scripts/run_recently_watched_collections_refresher.sh
M	src/scripts/run_sonarr_duplicate_cleaner.sh
M	src/scripts/run_sonarr_monitor_confirm.sh
M	src/scripts/run_sonarr_search_monitored.sh
M	src/tautulli_curated/helpers/change_of_taste_collection.py
M	src/tautulli_curated/helpers/chatgpt_utils.py
M	src/tautulli_curated/helpers/config_loader.py
A	src/tautulli_curated/helpers/google_search.py
M	src/tautulli_curated/helpers/immaculate_taste_refresher.py
M	src/tautulli_curated/helpers/pipeline_recent_watch.py
M	src/tautulli_curated/helpers/plex_collection_manager.py
M	src/tautulli_curated/helpers/recently_watched_collection.py
M	src/tautulli_curated/helpers/recently_watched_collections_refresher.py
M	src/tautulli_curated/helpers/recommender.py
M	src/tautulli_curated/helpers/sonarr_utils.py
R059	src/tautulli_curated/helpers/unmonitor_radarr_after_download.py	src/tautulli_curated/helpers/unmonitor_media_after_download.py
M	src/tautulli_curated/main.py
M	tautulli_immaculate_taste_collection.py
```

</details>

---

## Version 5.0.0

- **Tag**: `v5.0.0` (`1ad5962`, 2025-12-30)
- **Diff base**: `v4.1.0..v5.0.0`

### Highlights (since v4.1.0)

- **Sonarr TV show support**:
  - Duplicate episode cleaner
  - Monitor confirm logic (episode/season/series)
  - “Search monitored” trigger for missing episodes
- **Expanded unmonitoring**: extended post-download unmonitor logic to handle TV flows.

### Upgrade notes

- **New config**: Sonarr URL/API key/root folder/tag/quality profile, plus script enable flags for Sonarr tasks.

<details>
<summary><strong>Commits (v4.1.0..v5.0.0)</strong></summary>

```text
1ad5962 Merge pull request #10 from ohmzi/feature/v5.0-sonarr-support
2cb46da Release v5.0.0: Add Sonarr TV Show Support Major Features: - Add Sonarr duplicate episode cleaner script - Add Sonarr monitor confirm with granular unmonitoring (episode/season/series) - Extend unmonitor script to handle episodes and seasons - Add Sonarr search monitored episodes script - Add season-level unmonitoring when entire seasons added to Plex
```

</details>

<details>
<summary><strong>Files changed (v4.1.0..v5.0.0)</strong></summary>

```text
M	config/config.yaml
M	docs/README.md
D	sample_run_pictures/radarr_unmonitor_log.png
D	sample_run_pictures/tautulli_log_screenshot_1.jpg
D	sample_run_pictures/tautulli_log_screenshot_2.jpg
D	sample_run_pictures/tautulli_log_screenshot_3.jpg
M	src/scripts/run_immaculate_taste_refresher.sh
M	src/scripts/run_recently_watched_collections_refresher.sh
A	src/scripts/run_sonarr_duplicate_cleaner.sh
A	src/scripts/run_sonarr_monitor_confirm.sh
A	src/scripts/run_sonarr_search_monitored.sh
M	src/tautulli_curated/helpers/config_loader.py
A	src/tautulli_curated/helpers/sonarr_duplicate_cleaner.py
A	src/tautulli_curated/helpers/sonarr_monitor_confirm.py
A	src/tautulli_curated/helpers/sonarr_utils.py
M	src/tautulli_curated/helpers/unmonitor_radarr_after_download.py
```

</details>

---

## Version 4.1.0

- **Tag**: `v4.1.0` (`2affdf7`, 2025-12-29)
- **Diff base**: `v4.0.0..v4.1.0`

### Highlights (since v4.0.0)

- **Radarr improvements**: multiple tags support.
- **Collection correctness**: improved ordering and filtering (skip non-movie media where appropriate).
- **Refresher performance/robustness**: consistency improvements across scripts.

<details>
<summary><strong>Commits (v4.0.0..v4.1.0)</strong></summary>

```text
2affdf7 Merge pull request #9 from ohmzi/feat/collection-refresher-fixes-and-improvements
7b1b748 feat: add Radarr multiple tags support, fix collection ordering, and skip non-movie media
```

</details>

<details>
<summary><strong>Files changed (v4.0.0..v4.1.0)</strong></summary>

```text
M	config/config.yaml
M	docs/README.md
M	src/tautulli_curated/helpers/change_of_taste_collection.py
M	src/tautulli_curated/helpers/config_loader.py
M	src/tautulli_curated/helpers/radarr_utils.py
M	src/tautulli_curated/helpers/recently_watched_collection.py
M	src/tautulli_curated/helpers/recently_watched_collections_refresher.py
M	src/tautulli_curated/main.py
```

</details>

---

## Version 4.0.0

- **Tag**: `v4.0.0` (`0903a52`, 2025-12-28)
- **Diff base**: `v3.0.0..v4.0.0`

### Highlights (since v3.0.0)

- **Major system overhaul** into a modular multi-collection pipeline:
  - Recently Watched collection
  - Change of Taste collection
  - Duplicate cleaner
  - Radarr monitor confirm
  - Retry/backoff utilities
- **Operational docs**: error handling + execution flow documentation.
- **Artwork support**: added poster/background assets and automatic artwork setting.

<details>
<summary><strong>Commits (v3.0.0..v4.0.0)</strong></summary>

```text
0903a52 Merge pull request #8 from ohmzi/feature/v4.2.0-improvements
6cfc844 feat: Overhaul script execution into a modular, multi-collection pipeline
```

</details>

<details>
<summary><strong>Files changed (v3.0.0..v4.0.0)</strong></summary>

```text
A	.idea/caches/deviceStreaming.xml
A	assets/collection_artwork/PLACE_IMAGES_HERE.txt
A	assets/collection_artwork/README.md
A	assets/collection_artwork/backgrounds/change_of_taste_collection.png
A	assets/collection_artwork/backgrounds/immaculate_taste_collection.png
A	assets/collection_artwork/backgrounds/recently_watched_collection.png
A	assets/collection_artwork/posters/change_of_taste_collection.png
A	assets/collection_artwork/posters/immaculate_taste_collection.png
A	assets/collection_artwork/posters/recently_watched_collection.png
M	config/config.yaml
A	docs/ERROR_HANDLING.md
A	docs/EXECUTION_FLOW.md
M	docs/README.md
D	requirements.txt
R092	src/scripts/run_refresher.sh	src/scripts/run_immaculate_taste_refresher.sh
A	src/scripts/run_radarr_monitor_confirm.sh
A	src/scripts/run_radarr_search_monitored.sh
A	src/scripts/run_recently_watched_collections_refresher.sh
A	src/tautulli_curated/helpers/change_of_taste_collection.py
M	src/tautulli_curated/helpers/chatgpt_utils.py
M	src/tautulli_curated/helpers/config_loader.py
R089	src/tautulli_curated/refresher.py	src/tautulli_curated/helpers/immaculate_taste_refresher.py
M	src/tautulli_curated/helpers/pipeline_recent_watch.py
M	src/tautulli_curated/helpers/plex_collection_manager.py
A	src/tautulli_curated/helpers/plex_duplicate_cleaner.py
M	src/tautulli_curated/helpers/plex_search.py
A	src/tautulli_curated/helpers/radarr_monitor_confirm.py
M	src/tautulli_curated/helpers/radarr_utils.py
A	src/tautulli_curated/helpers/recently_watched_collection.py
A	src/tautulli_curated/helpers/recently_watched_collections_refresher.py
M	src/tautulli_curated/helpers/recommender.py
A	src/tautulli_curated/helpers/retry_utils.py
A	src/tautulli_curated/helpers/unmonitor_radarr_after_download.py
M	src/tautulli_curated/main.py
```

</details>

---

## Version 3.0.0

- **Tag**: `v3.0.0` (`049ab34`, 2025-12-27)
- **Diff base**: `v2.0.0..v3.0.0`

### Highlights (since v2.0.0)

- **Professional project structure**:
  - Moved to a real Python package under `src/tautulli_curated/`
  - Moved config/data/docker/docs into standard folders (`config/`, `data/`, `docker/`, `docs/`)
- **Standalone script runner** added under `src/scripts/`.

<details>
<summary><strong>Commits (v2.0.0..v3.0.0)</strong></summary>

```text
049ab34 Merge pull request #7 from ohmzi/feature/independent-sorting-script
3a6148e Add new helper modules for Plex and TMDb integration
56eeb9a feat: Enhance Plex collection management and midnight organizer script
```

</details>

<details>
<summary><strong>Files changed (v2.0.0..v3.0.0)</strong></summary>

```text
A	.gitignore
R076	config.yaml	config/config.yaml
R100	recommendation_points.json	data/recommendation_points.json
R100	tmdb_cache.json	data/tmdb_cache.json
R092	custom-tautulli/Dockerfile	docker/custom-tautulli/Dockerfile
R089	custom-tautulli/docker-compose.yml	docker/custom-tautulli/docker-compose.yml
R100	custom-tautulli/requirements.txt	docker/custom-tautulli/requirements.txt
R053	README.md	docs/README.md
D	helpers/plex_collection_manager.py
A	src/scripts/run_refresher.sh
A	src/tautulli_curated/__init__.py
A	src/tautulli_curated/main.py
A	src/tautulli_curated/refresher.py
A	src/tautulli_curated/helpers/plex_collection_manager.py
M	tautulli_immaculate_taste_collection.py
```

</details>

---

## Version 2.0.0

- **Tag**: `v2.0.0` (`9315fb1`, 2025-12-26)
- **Diff base**: `v1.0.0..v2.0.0`

### Highlights (since v1.0.0)

- **Modular architecture** introduced (helpers for OpenAI, TMDb, Plex, Radarr).
- **Config loader + logging system** added as first-class components.
- **New primary entry script**: `tautulli_immaculate_taste_collection.py`.

<details>
<summary><strong>Commits (v1.0.0..v2.0.0)</strong></summary>

```text
9315fb1 Merge pull request #6 from ohmzi/feature/creating_pipeline_structure
45220b1 feat: Implement comprehensive configuration loader and logging system
```

</details>

<details>
<summary><strong>Files changed (v1.0.0..v2.0.0)</strong></summary>

```text
M	README.md
M	custom-tautulli/Dockerfile
M	custom-tautulli/requirements.txt
A	helpers/chatgpt_utils.py
A	helpers/config_loader.py
A	helpers/logger.py
A	helpers/pipeline_recent_watch.py
A	helpers/plex_collection_manager.py
A	helpers/plex_search.py
A	helpers/radarr_utils.py
A	helpers/recommender.py
A	helpers/run_context.py
A	helpers/tmdb_cache.py
A	helpers/tmdb_client.py
A	helpers/tmdb_recommender.py
A	tautulli_immaculate_taste_collection.py
D	plex_duplicate_cleaner.py
D	radarr_plex_monitor.py
D	tautulli_watched_movies.py
```

</details>

---

## Version 1.0.0

- **Tag**: `v1.0.0` (`0b18503`, 2025-04-17)

### Highlights

- Initial published version (early README + basic automation scripts).

---

## Appendix: How to verify diffs locally

- List tags:
  - `git tag --list | sort -V`
- Show commits between releases:
  - `git log --oneline v4.1.0..v5.0.0`
- Show file changes between releases:
  - `git diff --name-status v4.1.0..v5.0.0`


