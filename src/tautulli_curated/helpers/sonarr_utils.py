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

