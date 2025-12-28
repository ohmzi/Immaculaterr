#!/usr/bin/env python3
"""
Unmonitor Radarr After Download Helper

Unmonitors a movie in Radarr and removes it from Plex watchlist after it's been downloaded.
"""

import sys
from pathlib import Path

# Add project root to path for standalone execution
# Go up from unmonitor_radarr_after_download.py -> helpers/ -> tautulli_curated/ -> src/ -> project root
project_root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(project_root / "src"))

import requests
import time
import difflib
import xml.etree.ElementTree as ET
from plexapi.server import PlexServer
from plexapi.myplex import MyPlexAccount
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config

logger = setup_logger("unmonitor_radarr_after_download")


def fetch_radarr_movies(api_url, api_key, log):
    """Fetch all movies from Radarr with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    def _fetch():
        r = requests.get(api_url, headers={'X-Api-Key': api_key}, timeout=60)
        r.raise_for_status()
        return r.json()
    
    movies, success = retry_with_backoff(
        _fetch,
        max_retries=3,
        logger_instance=log,
        operation_name="Fetch Radarr movies",
        raise_on_final_failure=False,
    )
    
    return movies if success else None


def find_movie_by_title(movies, title, log):
    """Find movie in Radarr by title (exact, normalized, or fuzzy match)."""
    # Exact match
    for movie in movies:
        if movie.get('title', '').lower() == title.lower():
            return movie

    # Normalized match
    normalized_title = title.replace(" ", "").lower()
    for movie in movies:
        if movie.get('title', '').replace(" ", "").lower() == normalized_title:
            log.info("radarr: matched by normalized title=%r -> %r", title, movie.get('title'))
            return movie

    # Fuzzy match
    titles = [m.get('title', '') for m in movies]
    close_matches = difflib.get_close_matches(title, titles, n=1, cutoff=0.7)
    if close_matches:
        chosen = close_matches[0]
        for movie in movies:
            if movie.get('title') == chosen:
                log.info("radarr: matched by fuzzy title=%r -> %r", title, chosen)
                return movie
    return None


def confirm_unmonitored(api_url, api_key, movie_id, log, retries=3, delay=2):
    """Confirm that movie is unmonitored in Radarr with retry logic."""
    from tautulli_curated.helpers.retry_utils import safe_execute
    
    for attempt in range(1, retries + 1):
        time.sleep(delay)
        
        def _check():
            r = requests.get(f"{api_url}/{movie_id}", headers={'X-Api-Key': api_key}, timeout=30)
            r.raise_for_status()
            updated = r.json()
            return not updated.get('monitored', True)
        
        result = safe_execute(
            _check,
            logger_instance=log,
            operation_name=f"Confirm unmonitored for movie_id={movie_id}",
            default_return=False,
            log_errors=False,  # Don't log every attempt
        )
        
        if result:
            return True
        log.debug("radarr: confirm attempt=%d movie_id=%s still_monitored", attempt, movie_id)
    return False


def get_tmdb_id_from_plex_http(plex_url, plex_token, library_name, title, log):
    """Get TMDB ID from Plex using HTTP API (lightweight, no PlexAPI) with retry logic."""
    from tautulli_curated.helpers.retry_utils import safe_execute
    
    headers = {'X-Plex-Token': plex_token}

    def _get_sections():
        r = requests.get(f"{plex_url}/library/sections", headers=headers, timeout=30)
        r.raise_for_status()
        return r.text
    
    sections_text = safe_execute(
        _get_sections,
        logger_instance=log,
        operation_name="Get Plex library sections",
        default_return=None,
    )
    
    if not sections_text:
        return None

    root = ET.fromstring(sections_text)
    key = None
    for directory in root.findall(".//Directory"):
        if directory.attrib.get("title") == library_name:
            key = directory.attrib.get("key")
            break

    if not key:
        log.warning("plex: library not found title=%r", library_name)
        return None

    def _search_library():
        r = requests.get(f"{plex_url}/library/sections/{key}/all?title={title}", headers=headers, timeout=30)
        r.raise_for_status()
        return r.text
    
    result_text = safe_execute(
        _search_library,
        logger_instance=log,
        operation_name=f"Search Plex library for '{title}'",
        default_return=None,
    )
    
    if not result_text:
        return None

    root = ET.fromstring(result_text)
    for video in root.findall(".//Video"):
        guid = video.attrib.get("guid", "")
        if "tmdb://" in guid:
            try:
                return int(guid.split("tmdb://")[1])
            except Exception:
                return None
    return None


def find_movie_in_radarr_by_tmdb(api_url, api_key, tmdb_id, log):
    """Find movie in Radarr by TMDB ID with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    lookup_url = f"{api_url}/lookup/tmdb?tmdbId={tmdb_id}"
    
    def _lookup():
        r = requests.get(lookup_url, headers={'X-Api-Key': api_key}, timeout=30)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict):
            return data
        if isinstance(data, list) and data:
            return data[0]
        return None
    
    result, success = retry_with_backoff(
        _lookup,
        max_retries=3,
        logger_instance=log,
        operation_name=f"Radarr lookup by TMDB ID {tmdb_id}",
        raise_on_final_failure=False,
    )
    
    return result if success else None


def unmonitor_movie_in_radarr(movie_title, config, log) -> tuple[bool, int | None]:
    """
    Unmonitor a movie in Radarr.
    Returns (success, movie_year) where success is True if changed monitored -> False.
    """
    base_url = config.radarr.url.rstrip('/')
    api_url = f"{base_url}/api/v3/movie"
    api_key = config.radarr.api_key

    log.info("  Connecting to Radarr...")
    radarr_movies = fetch_radarr_movies(api_url, api_key, log)
    if radarr_movies is None:
        log.error("  ✗ Failed to fetch movies from Radarr")
        return False, None
    log.info(f"  ✓ Connected to Radarr (found {len(radarr_movies)} movies)")

    log.info("  Searching for movie in Plex to get TMDB ID...")
    tmdb_id = get_tmdb_id_from_plex_http(
        config.plex.url,
        config.plex.token,
        config.plex.movie_library_name,
        movie_title,
        log
    )

    movie = None
    if tmdb_id:
        log.info(f"  ✓ Found TMDB ID: {tmdb_id}")
        log.info("  Looking up movie in Radarr by TMDB ID...")
        movie = find_movie_in_radarr_by_tmdb(api_url, api_key, tmdb_id, log)
        if movie:
            log.info(f"  ✓ Found in Radarr by TMDB ID: {movie.get('title', movie_title)}")
    else:
        log.info("  ⚠ TMDB ID not found in Plex, trying title matching...")

    if not movie:
        log.info("  Searching Radarr by movie title...")
        movie = find_movie_by_title(radarr_movies, movie_title, log)
        if movie:
            log.info(f"  ✓ Found in Radarr by title: {movie.get('title', movie_title)}")

    if not movie:
        log.warning(f"  ✗ Movie not found in Radarr: {movie_title}")
        return False, None

    movie_year = movie.get("year")
    movie_radarr_title = movie.get('title', movie_title)

    if not movie.get('monitored', True):
        log.info(f"  ⚠ Movie '{movie_radarr_title}' is already unmonitored in Radarr")
        return False, movie_year
    
    log.info(f"  Movie '{movie_radarr_title}' is currently monitored, unmonitoring...")
    movie['monitored'] = False
    
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    def _unmonitor():
        r = requests.put(
            f"{api_url}/{movie['id']}",
            headers={'X-Api-Key': api_key},
            json=movie,
            timeout=60
        )
        r.raise_for_status()
        return True
    
    success, _ = retry_with_backoff(
        _unmonitor,
        max_retries=3,
        logger_instance=log,
        operation_name=f"Unmonitor '{movie_radarr_title}' in Radarr",
        raise_on_final_failure=False,
    )
    
    if not success:
        log.error(f"  ✗ Failed to unmonitor movie in Radarr")
        return False, None

    log.info("  Confirming unmonitor status...")
    ok = confirm_unmonitored(api_url, api_key, movie['id'], log)
    if ok:
        log.info(f"  ✓ Successfully unmonitored '{movie_radarr_title}' in Radarr")
        return True, movie_year

    log.warning(f"  ⚠ Unmonitor command sent but confirmation failed for '{movie_radarr_title}'")
    return False, movie_year


def remove_from_plex_watchlist_with_retry(config, movie_title: str, log,
                                         movie_year: int | None = None,
                                         retries: int = 5, delay: int = 3) -> bool:
    """Remove movie from Plex watchlist with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    log.info("  Connecting to Plex...")
    def _connect_plex():
        return PlexServer(config.plex.url, config.plex.token, timeout=30)
    
    plex, success = retry_with_backoff(
        _connect_plex,
        max_retries=3,
        logger_instance=log,
        operation_name="Plex connection for watchlist",
        raise_on_final_failure=False,
    )
    
    if not success or plex is None:
        log.warning("  ✗ Failed to connect to Plex, skipping watchlist removal")
        return False
    
    log.info("  ✓ Connected to Plex")

    log.info("  Accessing Plex account...")
    # Plex changed watchlist backend; force plexapi to use DISCOVER instead of METADATA
    MyPlexAccount.METADATA = MyPlexAccount.DISCOVER

    try:
        account = plex.myPlexAccount()
        log.info("  ✓ Plex account accessed")
    except Exception as e:
        log.warning(f"  ✗ Failed to access Plex account: {e}")
        return False

    def norm(s: str) -> str:
        return "".join(ch.lower() for ch in s if ch.isalnum())

    wanted_norm = norm(movie_title)
    log.info("  Searching watchlist for movie...")

    for attempt in range(1, retries + 1):
        try:
            wl = account.watchlist(libtype="movie")
        except Exception as e:
            log.warning(f"  ⚠ Failed to fetch watchlist (attempt {attempt}/{retries}): {e}")
            if attempt < retries:
                time.sleep(delay)
            continue

        if not wl:
            log.info("  ⚠ Watchlist is empty or unavailable")
            return False

        log.info(f"  ✓ Watchlist loaded ({len(wl)} items)")

        candidates = []
        for item in wl:
            t = getattr(item, "title", "") or ""
            y = getattr(item, "year", None)
            if norm(t) == wanted_norm and (movie_year is None or y == movie_year):
                candidates.append(item)

        if not candidates:
            titles = [getattr(i, "title", "") or "" for i in wl]
            close = difflib.get_close_matches(movie_title, titles, n=1, cutoff=0.80)
            if close:
                picked = close[0]
                candidates = [i for i in wl if (getattr(i, "title", "") or "") == picked]

        if not candidates:
            log.info(f"  ⚠ Movie not found in watchlist (attempt {attempt}/{retries})")
            if attempt < retries:
                time.sleep(delay)
            continue

        log.info(f"  ✓ Found {len(candidates)} matching item(s) in watchlist")
        removed_any = False
        for item in candidates:
            try:
                account.removeFromWatchlist(item)
                item_title = getattr(item, "title", None) or movie_title
                item_year = getattr(item, "year", None)
                log.info(f"  ✓ Removed from watchlist: {item_title} ({item_year})")
                removed_any = True
            except Exception as e:
                log.warning(f"  ✗ Failed to remove item from watchlist: {e}")

        return removed_any

    log.warning(f"  ✗ Failed to remove movie from watchlist after {retries} attempts")
    return False


def run_unmonitor_radarr_after_download(movie_title: str, config=None, log_parent=None):
    """
    Main function to unmonitor movie in Radarr and remove from watchlist.
    Returns (radarr_unmonitored, watchlist_removed)
    """
    log = log_parent or logger
    config = config or load_config()

    log.info("=" * 60)
    log.info("UNMONITOR RADARR AFTER DOWNLOAD START")
    log.info("=" * 60)
    log.info(f"Movie: {movie_title}")
    log.info("")

    log.info("Step 1: Unmonitoring movie in Radarr...")
    radarr_unmonitored, movie_year = unmonitor_movie_in_radarr(movie_title, config, log)
    
    if radarr_unmonitored:
        log.info(f"  ✓ Movie successfully unmonitored in Radarr")
    elif movie_year:
        log.info(f"  ⚠ Movie was already unmonitored in Radarr (no action needed)")
    else:
        log.warning(f"  ✗ Movie not found in Radarr or failed to unmonitor")
    
    log.info("")
    log.info("Step 2: Removing movie from Plex watchlist...")
    watchlist_removed = remove_from_plex_watchlist_with_retry(
        config,
        movie_title,
        log,
        movie_year=movie_year
    )
    
    if watchlist_removed:
        log.info(f"  ✓ Movie successfully removed from Plex watchlist")
    else:
        log.info(f"  ⚠ Movie was not in watchlist or could not be removed (non-critical)")

    log.info("")
    log.info("=" * 60)
    log.info("UNMONITOR RADARR AFTER DOWNLOAD SUMMARY")
    log.info("=" * 60)
    log.info(f"Movie: {movie_title}")
    log.info(f"Radarr Unmonitored: {'✓ Yes' if radarr_unmonitored else '✗ No (already unmonitored or not found)'}")
    log.info(f"Watchlist Removed: {'✓ Yes' if watchlist_removed else '✗ No (not in watchlist or already removed)'}")
    log.info("=" * 60)

    return radarr_unmonitored, watchlist_removed


def main():
    """Main entry point for standalone script execution."""
    # Check command line arguments
    if len(sys.argv) < 2:
        print('Usage: python3 unmonitor_radarr_after_download.py "Movie Title" [media_type]')
        print('  media_type: "movie" (required for processing, other types ignored for now)')
        return 1
    
    movie_title = sys.argv[1]
    media_type = sys.argv[2].lower().strip() if len(sys.argv) > 2 else "movie"
    
    logger.info("=" * 60)
    logger.info("UNMONITOR RADARR AFTER DOWNLOAD SCRIPT")
    logger.info("=" * 60)
    logger.info(f"Movie: {movie_title}")
    logger.info(f"Media type: {media_type}")
    logger.info("")
    
    # Check if media type is movie
    if media_type != "movie":
        logger.info(f"Media type '{media_type}' is not 'movie' - skipping processing")
        logger.info("  Note: Only 'movie' media type is currently supported")
        logger.info("  Other media types will be supported in future versions")
        logger.info("")
        logger.info("=" * 60)
        logger.info("UNMONITOR RADARR AFTER DOWNLOAD END (skipped)")
        logger.info("=" * 60)
        return 0
    
    try:
        config = load_config()
        radarr_unmonitored, watchlist_removed = run_unmonitor_radarr_after_download(
            movie_title=movie_title,
            config=config
        )
        
        logger.info("")
        logger.info("=" * 60)
        if radarr_unmonitored or watchlist_removed:
            logger.info("UNMONITOR RADARR AFTER DOWNLOAD END OK")
        else:
            logger.info("UNMONITOR RADARR AFTER DOWNLOAD END (no changes needed)")
        logger.info("=" * 60)
        
        return 0
    except KeyboardInterrupt:
        logger.warning("")
        logger.warning("Script interrupted by user")
        logger.info("=" * 60)
        logger.info("UNMONITOR RADARR AFTER DOWNLOAD END (interrupted)")
        logger.info("=" * 60)
        return 130
    except Exception as e:
        logger.exception("")
        logger.error("=" * 60)
        logger.error("UNMONITOR RADARR AFTER DOWNLOAD END FAIL")
        logger.error("=" * 60)
        return 1


if __name__ == "__main__":
    sys.exit(main())

