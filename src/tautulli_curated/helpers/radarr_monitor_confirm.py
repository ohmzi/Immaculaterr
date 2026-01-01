#!/usr/bin/env python3
"""
Radarr Monitor Confirm Helper

Checks monitored movies in Radarr; if a movie already exists in Plex, unmonitor it in Radarr.
"""

import requests
from plexapi.server import PlexServer
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from typing import Any, Dict, List, Set, Tuple

logger = setup_logger("radarr_monitor_confirm")


def get_radarr_monitored_movies(config, log):
    """Get all monitored movies from Radarr with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    def _get_movies():
        url = f"{config.radarr.url.rstrip('/')}/api/v3/movie"
        headers = {"X-Api-Key": config.radarr.api_key}
        r = requests.get(url, headers=headers, timeout=60)
        r.raise_for_status()
        return [m for m in r.json() if m.get('monitored', False)]
    
    movies, success = retry_with_backoff(
        _get_movies,
        max_retries=3,
        logger_instance=log,
        operation_name="Get Radarr monitored movies",
        raise_on_final_failure=False,
    )
    
    return movies if success else []


def get_radarr_monitored_movies_with_status(config, log) -> Tuple[List[Dict[str, Any]], bool]:
    """Get all monitored movies from Radarr with retry logic, returning (movies, success)."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff

    def _get_movies():
        url = f"{config.radarr.url.rstrip('/')}/api/v3/movie"
        headers = {"X-Api-Key": config.radarr.api_key}
        r = requests.get(url, headers=headers, timeout=60)
        r.raise_for_status()
        return [m for m in r.json() if m.get('monitored', False)]

    movies, success = retry_with_backoff(
        _get_movies,
        max_retries=3,
        logger_instance=log,
        operation_name="Get Radarr monitored movies",
        raise_on_final_failure=False,
    )

    return (movies or []), bool(success)


def get_plex_tmdb_ids(config, log):
    """Get all TMDB IDs from Plex library with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    def _get_movies():
        plex = PlexServer(config.plex.url, config.plex.token, timeout=30)
        return plex.library.section(config.plex.movie_library_name).all()
    
    movies, success = retry_with_backoff(
        _get_movies,
        max_retries=3,
        logger_instance=log,
        operation_name="Get Plex movies for TMDB IDs",
        raise_on_final_failure=False,
    )
    
    if not success:
        return set()

    tmdb_ids = set()
    for movie in movies:
        for guid in getattr(movie, "guids", []) or []:
            if 'tmdb' in guid.id:
                try:
                    tmdb_id = int(guid.id.split('//')[-1])
                    tmdb_ids.add(tmdb_id)
                except Exception:
                    pass
    return tmdb_ids


def get_plex_tmdb_ids_with_status(config, log) -> Tuple[Set[int], bool]:
    """Get all TMDB IDs from Plex library with retry logic, returning (tmdb_ids, success)."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff

    def _get_movies():
        plex = PlexServer(config.plex.url, config.plex.token, timeout=30)
        return plex.library.section(config.plex.movie_library_name).all()

    movies, success = retry_with_backoff(
        _get_movies,
        max_retries=3,
        logger_instance=log,
        operation_name="Get Plex movies for TMDB IDs",
        raise_on_final_failure=False,
    )

    if not success or not movies:
        return set(), False

    tmdb_ids: Set[int] = set()
    for movie in movies:
        for guid in getattr(movie, "guids", []) or []:
            if 'tmdb' in guid.id:
                try:
                    tmdb_id = int(guid.id.split('//')[-1])
                    tmdb_ids.add(tmdb_id)
                except Exception:
                    pass
    return tmdb_ids, True


def unmonitor_in_radarr(movie, config, log) -> bool:
    """Unmonitor a movie in Radarr with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    movie['monitored'] = False
    url = f"{config.radarr.url.rstrip('/')}/api/v3/movie/{movie['id']}"
    headers = {"X-Api-Key": config.radarr.api_key}
    
    def _unmonitor():
        r = requests.put(url, json=movie, headers=headers, timeout=60)
        r.raise_for_status()
        return True
    
    _, success = retry_with_backoff(
        _unmonitor,
        max_retries=3,
        logger_instance=log,
        operation_name=f"Unmonitor '{movie.get('title')}' in Radarr",
        raise_on_final_failure=False,
    )
    
    return success


def run_radarr_monitor_confirm(config=None, dry_run=False, log_parent=None):
    """
    Check monitored movies in Radarr and unmonitor those already in Plex.
    Returns (total_monitored, already_in_plex, unmonitored_count)
    """
    log = log_parent or logger
    config = config or load_config()

    log.info("confirm: start checking monitored movies in Radarr...")
    
    monitored = get_radarr_monitored_movies(config, log)
    plex_tmdb_ids = get_plex_tmdb_ids(config, log)

    total_monitored = len(monitored)
    in_plex = 0
    unmonitored = 0

    log.info("confirm: found %d monitored movies in Radarr", total_monitored)
    log.info("confirm: found %d movies in Plex", len(plex_tmdb_ids))

    for movie in monitored:
        tmdb_id = movie.get('tmdbId')
        if not tmdb_id:
            continue

        if tmdb_id in plex_tmdb_ids:
            in_plex += 1
            title = movie.get("title")
            if dry_run:
                log.info("confirm: in_plex (dry_run) title=%r tmdb=%s -> would_unmonitor", title, tmdb_id)
                unmonitored += 1
            else:
                ok = unmonitor_in_radarr(movie, config, log)
                log.info("confirm: in_plex title=%r tmdb=%s unmonitored=%s", title, tmdb_id, ok)
                if ok:
                    unmonitored += 1

    log.info("SUMMARY radarr_confirm_plex total_monitored=%d already_in_plex=%d unmonitored=%d dry_run=%s",
             total_monitored, in_plex, unmonitored, dry_run)

    return total_monitored, in_plex, unmonitored


def run_radarr_monitor_confirm_with_stats(config=None, dry_run=False, log_parent=None):
    """
    Like run_radarr_monitor_confirm, but also returns a stats dict for monitoring/alerting.

    Returns:
        (total_monitored, already_in_plex, unmonitored_count, stats_dict)
    """
    log = log_parent or logger
    config = config or load_config()

    log.info("confirm: start checking monitored movies in Radarr...")

    monitored, radarr_ok = get_radarr_monitored_movies_with_status(config, log)
    plex_tmdb_ids, plex_ok = get_plex_tmdb_ids_with_status(config, log)

    total_monitored = len(monitored)
    in_plex = 0
    unmonitored = 0
    failed_unmonitor = 0

    log.info("confirm: found %d monitored movies in Radarr", total_monitored)
    log.info("confirm: found %d movies in Plex", len(plex_tmdb_ids))

    for movie in monitored:
        tmdb_id = movie.get('tmdbId')
        if not tmdb_id:
            continue

        if tmdb_id in plex_tmdb_ids:
            in_plex += 1
            title = movie.get("title")
            if dry_run:
                log.info("confirm: in_plex (dry_run) title=%r tmdb=%s -> would_unmonitor", title, tmdb_id)
                unmonitored += 1
            else:
                ok = bool(unmonitor_in_radarr(movie, config, log))
                log.info("confirm: in_plex title=%r tmdb=%s unmonitored=%s", title, tmdb_id, ok)
                if ok:
                    unmonitored += 1
                else:
                    failed_unmonitor += 1

    stats = {
        "dry_run": bool(dry_run),
        "radarr_ok": bool(radarr_ok),
        "plex_ok": bool(plex_ok),
        "failed_unmonitor": int(failed_unmonitor),
    }

    log.info(
        "SUMMARY radarr_confirm_plex total_monitored=%d already_in_plex=%d unmonitored=%d dry_run=%s stats=%s",
        total_monitored,
        in_plex,
        unmonitored,
        dry_run,
        stats,
    )

    return total_monitored, in_plex, unmonitored, stats

