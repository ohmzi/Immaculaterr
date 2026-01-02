# helpers/sonarr_utils.py
import requests
from typing import Optional, Dict, Any, Tuple, List
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.retry_utils import retry_with_backoff, safe_execute

logger = setup_logger("sonarr")

# Default timeout values
SONARR_TIMEOUT_SHORT = 30  # For quick operations
SONARR_TIMEOUT_LONG = 60   # For operations that may take longer


def _headers(cfg):
    """Get Sonarr API headers."""
    return {"X-Api-Key": cfg.sonarr.api_key}


def _base(cfg):
    """Get Sonarr base URL."""
    return cfg.sonarr.url.rstrip("/")


def get_or_create_tag(cfg, tag_name: str) -> Optional[int]:
    """Get or create a Sonarr tag with retry logic."""
    def _get_tags():
        r = requests.get(f"{_base(cfg)}/api/v3/tag", headers=_headers(cfg), timeout=SONARR_TIMEOUT_SHORT)
        r.raise_for_status()
        return r.json()
    
    def _create_tag():
        r = requests.post(
            f"{_base(cfg)}/api/v3/tag",
            json={"label": tag_name},
            headers=_headers(cfg),
            timeout=SONARR_TIMEOUT_SHORT,
        )
        r.raise_for_status()
        return r.json()["id"]
    
    # Try to get existing tags with retry
    tags, success = retry_with_backoff(
        _get_tags,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr get tags",
        raise_on_final_failure=False,
    )
    
    if not success or tags is None:
        logger.warning(f"Failed to get Sonarr tags, skipping tag creation for '{tag_name}'")
        return None
    
    # Check if tag exists
    for tag in tags:
        if tag.get("label", "").lower() == tag_name.lower():
            return tag["id"]
    
    # Create tag with retry
    logger.info(f"Creating Sonarr tag: {tag_name}")
    tag_id, success = retry_with_backoff(
        _create_tag,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr create tag '{tag_name}'",
        raise_on_final_failure=False,
    )
    
    return tag_id if success else None


def _sonarr_get_all_series(cfg) -> list:
    """Get all series from Sonarr with retry logic."""
    def _get_series():
        r = requests.get(f"{_base(cfg)}/api/v3/series", headers=_headers(cfg), timeout=SONARR_TIMEOUT_LONG)
        r.raise_for_status()
        return r.json()
    
    series, success = retry_with_backoff(
        _get_series,
        max_retries=3,
        logger_instance=logger,
        operation_name="Sonarr get all series",
        raise_on_final_failure=False,
    )
    
    return series if success else []


def sonarr_find_series_by_tvdb_id(cfg, tvdb_id: int) -> Optional[Dict[str, Any]]:
    """Find series in Sonarr by TVDB ID with error handling."""
    series = _sonarr_get_all_series(cfg)
    for s in series:
        if s.get("tvdbId") == tvdb_id:
            return s
    return None


def sonarr_lookup_series(cfg, title: str) -> Optional[Dict[str, Any]]:
    """Lookup series in Sonarr with retry logic."""
    def _lookup():
        r = requests.get(
            f"{_base(cfg)}/api/v3/series/lookup",
            headers=_headers(cfg),
            params={"term": title},
            timeout=SONARR_TIMEOUT_SHORT,
        )
        r.raise_for_status()
        results = r.json()
        return results[0] if results else None
    
    result, success = retry_with_backoff(
        _lookup,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr lookup '{title}'",
        raise_on_final_failure=False,
    )
    
    return result if success else None


def sonarr_set_monitored(cfg, series: dict, monitored: bool = True) -> bool:
    """Set series monitored status in Sonarr with retry logic."""
    if series.get("monitored") is monitored:
        logger.info(f"Already monitored in Sonarr: {series.get('title')}")
        return True

    series_id = series["id"]
    updated = dict(series)
    updated["monitored"] = monitored

    def _set_monitored():
        r = requests.put(
            f"{_base(cfg)}/api/v3/series/{series_id}",
            json=updated,
            headers=_headers(cfg),
            timeout=SONARR_TIMEOUT_LONG,
        )
        r.raise_for_status()
        return True

    logger.info(f"Setting monitored={monitored} in Sonarr: {series.get('title')}")
    _, success = retry_with_backoff(
        _set_monitored,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr set monitored for '{series.get('title')}'",
        raise_on_final_failure=False,
    )
    
    return success


def sonarr_get_series_by_id(cfg, series_id: int) -> Optional[Dict[str, Any]]:
    """Fetch a single series object (includes seasons array) with retry logic."""
    series_id = int(series_id or 0)
    if series_id <= 0:
        return None

    def _get_series():
        r = requests.get(
            f"{_base(cfg)}/api/v3/series/{series_id}",
            headers=_headers(cfg),
            timeout=SONARR_TIMEOUT_LONG,
        )
        r.raise_for_status()
        return r.json()

    series, success = retry_with_backoff(
        _get_series,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr get series {series_id}",
        raise_on_final_failure=False,
    )
    return series if success and isinstance(series, dict) else None


def sonarr_add_series(cfg, title: str, *, search: bool = False) -> Tuple[bool, Optional[Dict[str, Any]], str]:
    """
    Add a series to Sonarr (or ensure it exists and is monitored).

    Args:
        cfg: App config
        title: Series title to lookup/add
        search: If True, Sonarr will search immediately upon add. If False, no search on add.

    Returns:
        (success, series_dict_or_none, action) where action is one of:
          - "added" (new series added)
          - "existing" (already existed; ensured monitored)
          - "failed"
    """
    tag_ids: list[int] = []
    if cfg.sonarr.tag_name:
        tag_names = cfg.sonarr.tag_name if isinstance(cfg.sonarr.tag_name, list) else [cfg.sonarr.tag_name]
        for tag_name in tag_names:
            if tag_name:
                tag_id = get_or_create_tag(cfg, tag_name)
                if tag_id:
                    tag_ids.append(tag_id)

    looked_up = sonarr_lookup_series(cfg, title)
    if not looked_up or not looked_up.get("tvdbId"):
        logger.warning(f"Could not resolve tvdbId for: {title}")
        return (False, None, "failed")

    tvdb_id = int(looked_up["tvdbId"])
    existing = sonarr_find_series_by_tvdb_id(cfg, tvdb_id)
    if existing:
        logger.info(f"Already in Sonarr by tvdbId: {existing.get('title')} -> forcing monitored")
        success = sonarr_set_monitored(cfg, existing, True)
        return (bool(success), existing if success else existing, "existing" if success else "failed")

    payload = {
        "title": looked_up.get("title", title),
        "tvdbId": tvdb_id,
        "qualityProfileId": cfg.sonarr.quality_profile_id,
        "rootFolderPath": cfg.sonarr.root_folder,
        "monitored": True,
        "addOptions": {
            "searchForMissingEpisodes": bool(search),
            "searchForCutoffUnmetEpisodes": bool(search),
        },
        "tags": tag_ids,
    }

    def _add_series():
        r = requests.post(
            f"{_base(cfg)}/api/v3/series",
            json=payload,
            headers=_headers(cfg),
            timeout=SONARR_TIMEOUT_LONG,
        )
        r.raise_for_status()
        return r.json() or {}

    logger.info(f"Adding series to Sonarr (search={bool(search)}): {payload['title']}")
    created, success = retry_with_backoff(
        _add_series,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr add series '{payload['title']}'",
        raise_on_final_failure=False,
    )
    if not success or not isinstance(created, dict):
        return (False, None, "failed")
    return (True, created, "added")


def sonarr_add_and_search(cfg, title: str) -> Tuple[bool, str]:
    """
    Add series to Sonarr and trigger search with retry logic.
    
    Returns:
        Tuple of (success, action) where action is "added", "monitored", or "failed"
    """
    tag_ids = []
    if cfg.sonarr.tag_name:
        # Handle both single tag (string) and multiple tags (list) for backward compatibility
        tag_names = cfg.sonarr.tag_name if isinstance(cfg.sonarr.tag_name, list) else [cfg.sonarr.tag_name]
        
        for tag_name in tag_names:
            if tag_name:  # Skip empty strings
                tag_id = get_or_create_tag(cfg, tag_name)
                if tag_id:
                    tag_ids.append(tag_id)

    looked_up = sonarr_lookup_series(cfg, title)
    if not looked_up or not looked_up.get("tvdbId"):
        logger.warning(f"Could not resolve tvdbId for: {title}")
        return (False, "failed")

    tvdb_id = int(looked_up["tvdbId"])
    existing = sonarr_find_series_by_tvdb_id(cfg, tvdb_id)
    if existing:
        logger.info(f"Already in Sonarr by tvdbId: {existing.get('title')} -> forcing monitored")
        success = sonarr_set_monitored(cfg, existing, True)
        return (success, "monitored" if success else "failed")

    payload = {
        "title": looked_up.get("title", title),
        "tvdbId": tvdb_id,
        "qualityProfileId": cfg.sonarr.quality_profile_id,
        "rootFolderPath": cfg.sonarr.root_folder,
        "monitored": True,
        "addOptions": {
            "searchForMissingEpisodes": True,
            "searchForCutoffUnmetEpisodes": True,
        },
        "tags": tag_ids,
    }

    def _add_series():
        r = requests.post(f"{_base(cfg)}/api/v3/series", json=payload, headers=_headers(cfg), timeout=SONARR_TIMEOUT_LONG)
        r.raise_for_status()
        return True

    logger.info(f"Adding series to Sonarr + searching: {payload['title']}")
    _, success = retry_with_backoff(
        _add_series,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr add series '{payload['title']}'",
        raise_on_final_failure=False,
    )
    
    return (success, "added" if success else "failed")


def sonarr_add_or_monitor_missing(cfg, titles: list[str]) -> Dict[str, int]:
    """
    Add or monitor missing series in Sonarr with error handling.
    
    Returns:
        Dictionary with stats: {"added": count, "monitored": count, "failed": count}
    """
    stats = {"added": 0, "monitored": 0, "failed": 0}
    
    for title in titles:
        try:
            success, action = sonarr_add_and_search(cfg, title)
            if success:
                if action == "added":
                    stats["added"] += 1
                elif action == "monitored":
                    stats["monitored"] += 1
                else:
                    stats["failed"] += 1
            else:
                stats["failed"] += 1
        except Exception as e:
            logger.error(f"Failed Sonarr add/monitor for '{title}': {e}")
            stats["failed"] += 1
    
    return stats


def sonarr_series_search(cfg, series_id: int) -> bool:
    """
    Trigger a targeted search for missing monitored episodes for a specific series.
    """
    series_id = int(series_id or 0)
    if series_id <= 0:
        return False

    def _trigger():
        r = requests.post(
            f"{_base(cfg)}/api/v3/command",
            json={"name": "SeriesSearch", "seriesId": series_id},
            headers=_headers(cfg),
            timeout=SONARR_TIMEOUT_SHORT,
        )
        r.raise_for_status()
        return True

    logger.info(f"Triggering Sonarr SeriesSearch for seriesId={series_id} ...")
    _, success = retry_with_backoff(
        _trigger,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr series search {series_id}",
        raise_on_final_failure=False,
    )
    return bool(success)


def sonarr_set_season_monitored(cfg, *, series_id: int, season_number: int, monitored: bool) -> bool:
    """
    Set season monitored status by updating the series object.
    """
    series_id = int(series_id or 0)
    season_number = int(season_number or 0)
    series = sonarr_get_series_by_id(cfg, series_id)
    if not series:
        return False

    seasons = series.get("seasons", []) or []
    target = None
    for s in seasons:
        if int(s.get("seasonNumber") or -1) == season_number:
            target = s
            break
    if target is None:
        return False

    if bool(target.get("monitored", False)) is bool(monitored):
        return True

    target["monitored"] = bool(monitored)
    updated = dict(series)
    updated["seasons"] = seasons

    def _update():
        r = requests.put(
            f"{_base(cfg)}/api/v3/series/{series_id}",
            json=updated,
            headers=_headers(cfg),
            timeout=SONARR_TIMEOUT_LONG,
        )
        r.raise_for_status()
        return True

    logger.info(f"Setting season monitored={bool(monitored)} in Sonarr: seriesId={series_id} season={season_number}")
    _, success = retry_with_backoff(
        _update,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr set season monitored series={series_id} season={season_number}",
        raise_on_final_failure=False,
    )
    return bool(success)


def sonarr_sync_episode_monitoring_with_plex(cfg, *, series_id: int, plex_series) -> Dict[str, int]:
    """
    Sync Sonarr episode monitoring with Plex:
      - Episodes that exist in Plex => monitored=False
      - Episodes missing from Plex => monitored=True

    Returns:
        {"monitored": count_set_true, "unmonitored": count_set_false, "total": episodes_seen}
    """
    from tautulli_curated.helpers.plex_tv_helpers import get_plex_episodes_set

    series_id = int(series_id or 0)
    if series_id <= 0 or plex_series is None:
        return {"monitored": 0, "unmonitored": 0, "total": 0}

    plex_eps = get_plex_episodes_set(plex_series)
    sonarr_eps = sonarr_get_episodes_by_series(cfg, series_id)

    set_true = 0
    set_false = 0
    total = 0

    # Track missing-episode seasons for season monitored updates
    missing_by_season: dict[int, bool] = {}

    for ep in sonarr_eps:
        total += 1
        try:
            season = int(ep.get("seasonNumber"))
            epnum = int(ep.get("episodeNumber"))
        except Exception:
            continue

        in_plex = (season, epnum) in plex_eps
        should_monitor = not in_plex
        missing_by_season[season] = missing_by_season.get(season, False) or should_monitor

        if bool(ep.get("monitored", False)) is bool(should_monitor):
            continue

        ok = sonarr_set_episode_monitored(cfg, ep, bool(should_monitor))
        if ok:
            if should_monitor:
                set_true += 1
            else:
                set_false += 1

    # Best-effort: set season monitored status based on whether that season has any missing episodes.
    try:
        series = sonarr_get_series_by_id(cfg, series_id)
        seasons = (series or {}).get("seasons", []) if isinstance(series, dict) else []
        changed = False
        for s in seasons or []:
            try:
                sn = int(s.get("seasonNumber"))
            except Exception:
                continue
            if sn not in missing_by_season:
                continue
            desired = bool(missing_by_season.get(sn, False))
            if bool(s.get("monitored", False)) is desired:
                continue
            s["monitored"] = desired
            changed = True
        if changed and isinstance(series, dict):
            updated = dict(series)
            updated["seasons"] = seasons

            def _update_series():
                r = requests.put(
                    f"{_base(cfg)}/api/v3/series/{series_id}",
                    json=updated,
                    headers=_headers(cfg),
                    timeout=SONARR_TIMEOUT_LONG,
                )
                r.raise_for_status()
                return True

            retry_with_backoff(
                _update_series,
                max_retries=3,
                logger_instance=logger,
                operation_name=f"Sonarr sync season monitored series={series_id}",
                raise_on_final_failure=False,
            )
    except Exception as e:
        logger.debug(f"Season monitored sync skipped (non-fatal): {type(e).__name__}: {e}")

    return {"monitored": set_true, "unmonitored": set_false, "total": total}


def sonarr_get_episodes_by_series(cfg, series_id: int) -> List[Dict[str, Any]]:
    """Get all episodes for a series from Sonarr with retry logic."""
    def _get_episodes():
        r = requests.get(
            f"{_base(cfg)}/api/v3/episode",
            headers=_headers(cfg),
            params={"seriesId": series_id},
            timeout=SONARR_TIMEOUT_LONG,
        )
        r.raise_for_status()
        return r.json()
    
    episodes, success = retry_with_backoff(
        _get_episodes,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr get episodes for series {series_id}",
        raise_on_final_failure=False,
    )
    
    return episodes if success else []


def sonarr_find_episode_by_series_and_episode(cfg, series_id: int, season: int, episode: int) -> Optional[Dict[str, Any]]:
    """Find specific episode in Sonarr by series ID, season, and episode number."""
    episodes = sonarr_get_episodes_by_series(cfg, series_id)
    for ep in episodes:
        if ep.get("seasonNumber") == season and ep.get("episodeNumber") == episode:
            return ep
    return None


def sonarr_set_episode_monitored(cfg, episode: dict, monitored: bool = True) -> bool:
    """Set episode monitored status in Sonarr with retry logic."""
    if episode.get("monitored") is monitored:
        logger.info(f"Episode already monitored={monitored} in Sonarr: S{episode.get('seasonNumber', 0):02d}E{episode.get('episodeNumber', 0):02d}")
        return True

    episode_id = episode["id"]
    updated = dict(episode)
    updated["monitored"] = monitored

    def _set_episode_monitored():
        r = requests.put(
            f"{_base(cfg)}/api/v3/episode/{episode_id}",
            json=updated,
            headers=_headers(cfg),
            timeout=SONARR_TIMEOUT_SHORT,
        )
        r.raise_for_status()
        return True

    logger.info(f"Setting episode monitored={monitored} in Sonarr: S{episode.get('seasonNumber', 0):02d}E{episode.get('episodeNumber', 0):02d}")
    _, success = retry_with_backoff(
        _set_episode_monitored,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Sonarr set episode monitored S{episode.get('seasonNumber', 0):02d}E{episode.get('episodeNumber', 0):02d}",
        raise_on_final_failure=False,
    )
    
    return success


def unmonitor_sonarr_episode_if_monitored(episode: dict, config, log) -> bool:
    """Unmonitor episode in Sonarr if it's currently monitored with retry logic."""
    if not episode:
        log.info("sonarr: no matching episode found; skipping unmonitor")
        return False

    if not episode.get("monitored", True):
        log.info("sonarr: already unmonitored (dupe_cleanup) S%02dE%02d", 
                 episode.get("seasonNumber", 0), episode.get("episodeNumber", 0))
        return False

    try:
        success = sonarr_set_episode_monitored(config, episode, False)
        if success:
            log.info("sonarr: unmonitored (dupe_cleanup) S%02dE%02d", 
                     episode.get("seasonNumber", 0), episode.get("episodeNumber", 0))
        return success
    except Exception as e:
        log.warning("sonarr: unmonitor failed (dupe_cleanup) S%02dE%02d err=%s", 
                   episode.get("seasonNumber", 0), episode.get("episodeNumber", 0), e)
        return False


def sonarr_search_monitored_episodes(cfg) -> bool:
    """
    Trigger a search for all missing monitored episodes in Sonarr.
    
    Returns:
        bool: True if the search command was successfully queued, False otherwise
    """
    def _trigger_search():
        r = requests.post(
            f"{_base(cfg)}/api/v3/command",
            json={
                "name": "MissingEpisodeSearch",
                "filterKey": "monitored",
                "filterValue": "true"
            },
            headers=_headers(cfg),
            timeout=SONARR_TIMEOUT_SHORT,
        )
        r.raise_for_status()
        return True
    
    logger.info("Triggering search for all missing monitored episodes in Sonarr...")
    _, success = retry_with_backoff(
        _trigger_search,
        max_retries=3,
        logger_instance=logger,
        operation_name="Sonarr search monitored episodes",
        raise_on_final_failure=False,
    )
    
    if success:
        logger.info("Search command successfully queued in Sonarr")
    else:
        logger.warning("Failed to trigger search command in Sonarr")
    
    return success

