#!/usr/bin/env python3
"""
Plex Duplicate Cleaner Helper

Checks for duplicates in Plex and deletes the lower quality version.
Also unmonitors the movie in Radarr after deletion.
"""

import requests
import argparse
import logging
from plexapi.server import PlexServer
from pathlib import Path
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple
from requests.exceptions import Timeout, ConnectionError as RequestsConnectionError
from urllib3.exceptions import ReadTimeoutError, ConnectTimeoutError
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


def get_plex_movies_with_status(config, log) -> Tuple[List[Any], bool]:
    """Get all movies from Plex library with retry logic, returning (movies, success)."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff

    def _get_movies():
        plex = PlexServer(config.plex.url, config.plex.token, timeout=30)
        return plex.library.section(config.plex.movie_library_name).all()

    movies, success = retry_with_backoff(
        _get_movies,
        max_retries=3,
        logger_instance=log,
        operation_name="Get Plex movies",
        raise_on_final_failure=False,
    )

    return (movies or []), bool(success)


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
    """Unmonitor movie in Radarr if it's currently monitored (best-effort)."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    if not movie:
        log.info("radarr: no matching movie found for tmdb; skipping unmonitor")
        return False

    if not movie.get("monitored", True):
        log.info("radarr: already unmonitored (dupe_cleanup) title=%r", movie.get("title"))
        return False

    # Avoid mutating the original dict Radarr returned
    updated = dict(movie)
    updated["monitored"] = False
    url = f"{config.radarr.url.rstrip('/')}/api/v3/movie/{updated['id']}"
    headers = {"X-Api-Key": config.radarr.api_key, "Content-Type": "application/json"}

    def _unmonitor():
        r = requests.put(url, headers=headers, json=updated, timeout=60)
        r.raise_for_status()
        return True

    _, success = retry_with_backoff(
        _unmonitor,
        max_retries=3,
        logger_instance=log,
        operation_name=f"Unmonitor '{updated.get('title')}' in Radarr (dupe_cleanup)",
        raise_on_final_failure=False,
    )

    if success:
        log.info("radarr: unmonitored (dupe_cleanup) title=%r", updated.get("title"))
        return True

    log.warning("radarr: unmonitor failed (dupe_cleanup) title=%r", updated.get("title"))
    return False


def process_duplicates(duplicates, config, log, *, dry_run: bool = False, stats: Optional[dict] = None) -> int:
    """Process and delete duplicate files. If dry_run=True, no changes are made."""
    deleted_files = 0
    if stats is None:
        stats = {}
    stats.setdefault("radarr_movie_not_found", 0)
    stats.setdefault("radarr_unmonitor_failed", 0)
    stats.setdefault("radarr_unmonitor_ok", 0)
    stats.setdefault("delete_failed", 0)
    stats.setdefault("would_delete", 0)
    stats.setdefault("would_unmonitor", 0)

    for tmdb_id, files in duplicates.items():
        # Stop Radarr from re-grabbing this title (best-effort)
        tmdb_id_cleaned = ''.join(filter(str.isdigit, str(tmdb_id)))
        radarr_movie = get_radarr_movie_by_tmdb_id(tmdb_id_cleaned, config, log)
        if not radarr_movie:
            stats["radarr_movie_not_found"] += 1
        else:
            if dry_run:
                stats["would_unmonitor"] += 1
                log.info("radarr: dry_run=ON would unmonitor (dupe_cleanup) title=%r", radarr_movie.get("title"))
            else:
                ok = bool(unmonitor_radarr_movie_if_monitored(radarr_movie, config, log))
                if ok:
                    stats["radarr_unmonitor_ok"] += 1
                else:
                    stats["radarr_unmonitor_failed"] += 1

        sorted_files = sort_files(files, config)
        to_delete = sorted_files[-1]

        log.info("dupe: found tmdb=%s candidates=%d", tmdb_id, len(sorted_files))

        if dry_run:
            stats["would_delete"] += 1
            log.info("dupe: dry_run=ON would delete file=%r", Path(to_delete['file']).name)
            continue

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
                stats["delete_failed"] += 1
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


def run_plex_duplicate_cleaner_with_stats(config=None, log_parent=None, *, dry_run: bool = False):
    """
    Run duplicate cleaner and return extra stats for monitoring.

    Returns:
        (duplicates_found_count, duplicates_deleted_count, stats_dict)
    """
    log = log_parent or logger

    if config is None:
        config = load_config()

    stats: Dict[str, Any] = {"dry_run": bool(dry_run)}

    log.info("dupe_scan: start library=%r", config.plex.movie_library_name)

    movies, plex_ok = get_plex_movies_with_status(config, log)
    stats["plex_ok"] = bool(plex_ok)
    stats["plex_movies_count"] = int(len(movies))

    if not plex_ok:
        log.error("dupe_scan: failed to fetch movies from Plex (after retries)")
        return 0, 0, stats

    duplicates = find_duplicates(movies)
    found = len(duplicates)
    deleted = 0

    if found:
        deleted = process_duplicates(duplicates, config, log, dry_run=dry_run, stats=stats)
        log.info("dupe_scan: done found=%d deleted=%d stats=%s", found, deleted, stats)
    else:
        log.info("dupe_scan: done found=0 deleted=0 stats=%s", stats)

    return found, deleted, stats


if __name__ == "__main__":
    def _parse_args():
        p = argparse.ArgumentParser(
            description="Radarr/Plex Duplicate Cleaner - deletes lower quality duplicate movies in Plex and unmonitors in Radarr",
        )
        p.add_argument("--dry-run", action="store_true", help="Show what would be deleted/unmonitored without making changes")
        p.add_argument("--verbose", "-v", action="store_true", help="Enable debug-level logging")
        return p.parse_args()

    def main() -> int:
        args = _parse_args()
        if args.verbose:
            logger.setLevel(logging.DEBUG)
            logger.debug("Verbose logging enabled")

        try:
            found, deleted, stats = run_plex_duplicate_cleaner_with_stats(dry_run=bool(args.dry_run))

            if args.dry_run:
                print(f"Found {found} duplicate movies, would delete {stats.get('would_delete', 0)} files")
            else:
                print(f"Found {found} duplicate movies, deleted {deleted} files")

            # Determine status + exit code
            if not stats.get("plex_ok", True):
                status = "DEPENDENCY_FAILED"
                exit_code = 20
            else:
                status = "SUCCESS"
                exit_code = 0
                if (stats.get("delete_failed", 0) or 0) > 0 or (stats.get("radarr_unmonitor_failed", 0) or 0) > 0:
                    status = "PARTIAL"
                    exit_code = 10

            logger.info(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
            return exit_code
        except KeyboardInterrupt:
            logger.warning("Interrupted by user")
            logger.info("FINAL_STATUS=INTERRUPTED FINAL_EXIT_CODE=130")
            return 130
        except Exception as e:
            dependency_failed = isinstance(e, (Timeout, RequestsConnectionError, ReadTimeoutError, ConnectTimeoutError))
            status = "DEPENDENCY_FAILED" if dependency_failed else "FAILED"
            exit_code = 20 if dependency_failed else 30
            logger.exception(f"Plex duplicate cleaner failed: {type(e).__name__}: {e}")
            logger.info(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
            return exit_code

    raise SystemExit(main())

