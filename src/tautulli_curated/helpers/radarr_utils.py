# helpers/radarr_utils.py
import requests
from typing import Optional, Dict, Any, Tuple
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.retry_utils import retry_with_backoff, safe_execute

logger = setup_logger("radarr")

# Default timeout values
RADARR_TIMEOUT_SHORT = 30  # For quick operations
RADARR_TIMEOUT_LONG = 60   # For operations that may take longer

def _headers(cfg):
    return {"X-Api-Key": cfg.radarr.api_key}

def _base(cfg):
    return cfg.radarr.url.rstrip("/")

def get_or_create_tag(cfg, tag_name: str) -> Optional[int]:
    """Get or create a Radarr tag with retry logic."""
    def _get_tags():
        r = requests.get(f"{_base(cfg)}/api/v3/tag", headers=_headers(cfg), timeout=RADARR_TIMEOUT_SHORT)
        r.raise_for_status()
        return r.json()
    
    def _create_tag():
        r = requests.post(
            f"{_base(cfg)}/api/v3/tag",
            json={"label": tag_name},
            headers=_headers(cfg),
            timeout=RADARR_TIMEOUT_SHORT,
        )
        r.raise_for_status()
        return r.json()["id"]
    
    # Try to get existing tags with retry
    tags, success = retry_with_backoff(
        _get_tags,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Radarr get tags",
        raise_on_final_failure=False,
    )
    
    if not success or tags is None:
        logger.warning(f"Failed to get Radarr tags, skipping tag creation for '{tag_name}'")
        return None
    
    # Check if tag exists
    for tag in tags:
        if tag.get("label", "").lower() == tag_name.lower():
            return tag["id"]
    
    # Create tag with retry
    logger.info(f"Creating Radarr tag: {tag_name}")
    tag_id, success = retry_with_backoff(
        _create_tag,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Radarr create tag '{tag_name}'",
        raise_on_final_failure=False,
    )
    
    return tag_id if success else None

def _radarr_get_all_movies(cfg) -> list:
    """Get all movies from Radarr with retry logic."""
    def _get_movies():
        r = requests.get(f"{_base(cfg)}/api/v3/movie", headers=_headers(cfg), timeout=RADARR_TIMEOUT_LONG)
        r.raise_for_status()
        return r.json()
    
    movies, success = retry_with_backoff(
        _get_movies,
        max_retries=3,
        logger_instance=logger,
        operation_name="Radarr get all movies",
        raise_on_final_failure=False,
    )
    
    return movies if success else []

def radarr_find_movie_by_tmdb_id(cfg, tmdb_id: int) -> Optional[Dict[str, Any]]:
    """Find movie in Radarr by TMDB ID with error handling."""
    movies = _radarr_get_all_movies(cfg)
    for movie in movies:
        if movie.get("tmdbId") == tmdb_id:
            return movie
    return None

def radarr_set_monitored(cfg, movie: dict, monitored: bool = True) -> bool:
    """Set movie monitored status in Radarr with retry logic."""
    if movie.get("monitored") is monitored:
        logger.info(f"Already monitored in Radarr: {movie.get('title')}")
        return True

    movie_id = movie["id"]
    updated = dict(movie)
    updated["monitored"] = monitored

    def _set_monitored():
        r = requests.put(
            f"{_base(cfg)}/api/v3/movie/{movie_id}",
            json=updated,
            headers=_headers(cfg),
            timeout=RADARR_TIMEOUT_LONG,
        )
        r.raise_for_status()
        return True

    logger.info(f"Setting monitored={monitored} in Radarr: {movie.get('title')}")
    _, success = retry_with_backoff(
        _set_monitored,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Radarr set monitored for '{movie.get('title')}'",
        raise_on_final_failure=False,
    )
    
    return success

def radarr_lookup_movie(cfg, title: str) -> Optional[Dict[str, Any]]:
    """Lookup movie in Radarr with retry logic."""
    def _lookup():
        r = requests.get(
            f"{_base(cfg)}/api/v3/movie/lookup",
            headers=_headers(cfg),
            params={"term": title},
            timeout=RADARR_TIMEOUT_SHORT,
        )
        r.raise_for_status()
        results = r.json()
        return results[0] if results else None
    
    result, success = retry_with_backoff(
        _lookup,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Radarr lookup '{title}'",
        raise_on_final_failure=False,
    )
    
    return result if success else None

def radarr_add_and_search(cfg, title: str) -> Tuple[bool, str]:
    """
    Add movie to Radarr and trigger search with retry logic.
    
    Returns:
        Tuple of (success, action) where action is "added", "monitored", or "failed"
    """
    tag_ids = []
    if cfg.radarr.tag_name:
        tag_id = get_or_create_tag(cfg, cfg.radarr.tag_name)
        if tag_id:
            tag_ids = [tag_id]

    looked_up = radarr_lookup_movie(cfg, title)
    if not looked_up or not looked_up.get("tmdbId"):
        logger.warning(f"Could not resolve tmdbId for: {title}")
        return (False, "failed")

    tmdb_id = int(looked_up["tmdbId"])
    existing = radarr_find_movie_by_tmdb_id(cfg, tmdb_id)
    if existing:
        logger.info(f"Already in Radarr by tmdbId: {existing.get('title')} -> forcing monitored")
        success = radarr_set_monitored(cfg, existing, True)
        return (success, "monitored" if success else "failed")

    payload = {
        "title": looked_up.get("title", title),
        "tmdbId": tmdb_id,
        "year": looked_up.get("year"),
        "qualityProfileId": cfg.radarr.quality_profile_id,
        "rootFolderPath": cfg.radarr.root_folder,
        "monitored": True,
        "addOptions": {"searchForMovie": True},
        "tags": tag_ids,
    }

    def _add_movie():
        r = requests.post(f"{_base(cfg)}/api/v3/movie", json=payload, headers=_headers(cfg), timeout=RADARR_TIMEOUT_LONG)
        r.raise_for_status()
        return True

    logger.info(f"Adding movie to Radarr + searching: {payload['title']}")
    _, success = retry_with_backoff(
        _add_movie,
        max_retries=3,
        logger_instance=logger,
        operation_name=f"Radarr add movie '{payload['title']}'",
        raise_on_final_failure=False,
    )
    
    return (success, "added" if success else "failed")

def radarr_add_or_monitor_missing(cfg, titles: list[str]) -> Dict[str, int]:
    """
    Add or monitor missing movies in Radarr with error handling.
    
    Returns:
        Dictionary with stats: {"added": count, "monitored": count, "failed": count}
    """
    stats = {"added": 0, "monitored": 0, "failed": 0}
    
    for title in titles:
        try:
            success, action = radarr_add_and_search(cfg, title)
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
            logger.error(f"Failed Radarr add/monitor for '{title}': {e}")
            stats["failed"] += 1
    
    return stats

