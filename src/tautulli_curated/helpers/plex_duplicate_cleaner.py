#!/usr/bin/env python3
"""
Plex Duplicate Cleaner Helper

Checks for duplicates in Plex and deletes the lower quality version.
Also unmonitors the movie in Radarr after deletion.
"""

import requests
from plexapi.server import PlexServer
from pathlib import Path
from collections import defaultdict
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config

logger = setup_logger("plex_duplicate_cleaner")


def get_plex_movies(config):
    """Get all movies from Plex library with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    def _get_movies():
        plex = PlexServer(config.plex.url, config.plex.token, timeout=30)
        return plex.library.section(config.plex.movie_library_name).all()
    
    movies, success = retry_with_backoff(
        _get_movies,
        max_retries=3,
        logger_instance=logger,
        operation_name="Get Plex movies",
        raise_on_final_failure=False,
    )
    
    return movies if success else []


def find_duplicates(movies):
    """Find duplicate movies by TMDB ID."""
    tmdb_dict = defaultdict(list)

    for movie in movies:
        tmdb_id = None
        for guid in getattr(movie, "guids", []) or []:
            if 'tmdb' in guid.id:
                tmdb_id = guid.id.split('//')[-1]
                break

        if tmdb_id and len(getattr(movie, "media", []) or []) > 0:
            for media in movie.media:
                for part in media.parts:
                    tmdb_dict[tmdb_id].append({
                        'movie': movie,
                        'file': part.file,
                        'size': part.size,
                        'quality': media.videoResolution,
                        'added_at': movie.addedAt
                    })

    return {k: v for k, v in tmdb_dict.items() if len(v) > 1}


def sort_files(files, config):
    """Sort files based on delete preference."""
    preserve_terms = config.plex.preserve_quality or []
    pref = config.plex.delete_preference

    filtered = [f for f in files if not any(
        term.lower() in str(f.get('quality', '')).lower() for term in preserve_terms
    )] or files

    reverse_sort = pref in ['largest_file', 'newest']
    if pref in ['largest_file', 'smallest_file']:
        return sorted(filtered, key=lambda x: x['size'], reverse=reverse_sort)
    if pref in ['newest', 'oldest']:
        return sorted(filtered, key=lambda x: x['added_at'], reverse=reverse_sort)

    return filtered


def get_radarr_movie_by_tmdb_id(tmdb_id, config, log):
    """Get Radarr movie by TMDB ID with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    def _get_movie():
        url = f"{config.radarr.url.rstrip('/')}/api/v3/movie"
        headers = {"X-Api-Key": config.radarr.api_key}
        r = requests.get(url, headers=headers, timeout=60)
        r.raise_for_status()
        movies = r.json()
        return next((m for m in movies if m.get("tmdbId") == int(tmdb_id)), None)
    
    movie, success = retry_with_backoff(
        _get_movie,
        max_retries=3,
        logger_instance=log,
        operation_name=f"Get Radarr movie by TMDB ID {tmdb_id}",
        raise_on_final_failure=False,
    )
    
    return movie if success else None


def unmonitor_radarr_movie_if_monitored(movie, config, log) -> bool:
    """Unmonitor movie in Radarr if it's currently monitored with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    if not movie:
        log.info("radarr: no matching movie found for tmdb; skipping unmonitor")
        return False

    if not movie.get("monitored", True):
        log.info("radarr: already unmonitored (dupe_cleanup) title=%r", movie.get("title"))
        return False

    try:
        movie["monitored"] = False
        url = f"{config.radarr.url.rstrip('/')}/api/v3/movie/{movie['id']}"
        headers = {"X-Api-Key": config.radarr.api_key, "Content-Type": "application/json"}
        r = requests.put(url, headers=headers, json=movie)
        r.raise_for_status()
        log.info("radarr: unmonitored (dupe_cleanup) title=%r", movie.get("title"))
        return True
    except Exception as e:
        log.warning("radarr: unmonitor failed (dupe_cleanup) title=%r err=%s", movie.get("title"), e)
        return False


def process_duplicates(duplicates, config, log) -> int:
    """Process and delete duplicate files."""
    deleted_files = 0

    for tmdb_id, files in duplicates.items():
        # Stop Radarr from re-grabbing this title
        tmdb_id_cleaned = ''.join(filter(str.isdigit, str(tmdb_id)))
        radarr_movie = get_radarr_movie_by_tmdb_id(tmdb_id_cleaned, config, log)
        unmonitor_radarr_movie_if_monitored(radarr_movie, config, log)

        sorted_files = sort_files(files, config)
        to_delete = sorted_files[-1]

        log.info("dupe: found tmdb=%s candidates=%d", tmdb_id, len(sorted_files))

        try:
            media = to_delete['movie'].media[0]
            media.delete()
            deleted_files += 1
            log.info("dupe: deleted file=%r", Path(to_delete['file']).name)
        except Exception as e:
            log.warning("dupe: deletion via plex failed err=%s; trying filesystem delete", e)
            try:
                Path(to_delete['file']).unlink()
                deleted_files += 1
                log.info("dupe: deleted via filesystem file=%r", to_delete['file'])
            except Exception as fs_e:
                log.error("dupe: filesystem deletion failed err=%s", fs_e)

    return deleted_files


def run_plex_duplicate_cleaner(config=None, log_parent=None):
    """
    Run duplicate cleaner.
    Returns (duplicates_found_count, duplicates_deleted_count)
    """
    log = log_parent or logger

    if config is None:
        config = load_config()

    log.info("dupe_scan: start library=%r", config.plex.movie_library_name)

    movies = get_plex_movies(config)
    duplicates = find_duplicates(movies)

    found = len(duplicates)
    deleted = 0

    if found:
        deleted = process_duplicates(duplicates, config, log)
        log.info("dupe_scan: done found=%d deleted=%d", found, deleted)
    else:
        log.info("dupe_scan: done found=0 deleted=0")

    return found, deleted

