#!/usr/bin/env python3
"""
Unmonitor Media After Download Helper

Unmonitors movies in Radarr or episodes/seasons in Sonarr and removes movies from Plex watchlist after they've been downloaded.
"""

import sys
from pathlib import Path

# Add project root to path for standalone execution
# Go up from unmonitor_media_after_download.py -> helpers/ -> tautulli_curated/ -> src/ -> project root
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

logger = setup_logger("unmonitor_media_after_download")


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


def remove_show_from_plex_watchlist_with_retry(config, series_title: str, log,
                                               retries: int = 5, delay: int = 3) -> bool:
    """Remove TV show from Plex watchlist with retry logic."""
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

    wanted_norm = norm(series_title)
    log.info("  Searching watchlist for TV show...")

    for attempt in range(1, retries + 1):
        try:
            wl = account.watchlist(libtype="show")
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
            if norm(t) == wanted_norm:
                candidates.append(item)

        if not candidates:
            titles = [getattr(i, "title", "") or "" for i in wl]
            close = difflib.get_close_matches(series_title, titles, n=1, cutoff=0.80)
            if close:
                picked = close[0]
                candidates = [i for i in wl if (getattr(i, "title", "") or "") == picked]

        if not candidates:
            log.info(f"  ⚠ TV show not found in watchlist (attempt {attempt}/{retries})")
            if attempt < retries:
                time.sleep(delay)
            continue

        log.info(f"  ✓ Found {len(candidates)} matching item(s) in watchlist")
        removed_any = False
        for item in candidates:
            try:
                account.removeFromWatchlist(item)
                item_title = getattr(item, "title", None) or series_title
                log.info(f"  ✓ Removed from watchlist: {item_title}")
                removed_any = True
            except Exception as e:
                log.warning(f"  ✗ Failed to remove item from watchlist: {e}")

        return removed_any

    log.warning(f"  ✗ Failed to remove TV show from watchlist after {retries} attempts")
    return False


def verify_all_season_episodes_in_plex(series_name: str, season_num: int, config, log) -> tuple[bool, str | None]:
    """
    Verify that ALL episodes in a season are in Plex.
    
    Returns:
        (all_present: bool, series_title_in_plex: str | None)
        - all_present: True if all episodes are in Plex, False otherwise
        - series_title_in_plex: The title of the series in Plex if found, None otherwise
    """
    from tautulli_curated.helpers import sonarr_utils
    from tautulli_curated.helpers.sonarr_utils import (
        _sonarr_get_all_series,
        sonarr_get_episodes_by_series,
    )
    from tautulli_curated.helpers.sonarr_monitor_confirm import (
        get_plex_tv_shows,
        get_tvdb_id_from_plex_series,
        get_plex_episodes_set,
    )
    from plexapi.server import PlexServer
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    import difflib
    
    # Get all series from Sonarr
    all_series = _sonarr_get_all_series(config)
    if not all_series:
        log.warning(f"  ✗ Failed to fetch series from Sonarr")
        return False, None
    
    # Find series by title (exact or fuzzy match)
    series = None
    for s in all_series:
        if s.get('title', '').lower() == series_name.lower():
            series = s
            break
    
    if not series:
        # Try fuzzy match
        titles = [s.get('title', '') for s in all_series]
        close_matches = difflib.get_close_matches(series_name, titles, n=1, cutoff=0.7)
        if close_matches:
            for s in all_series:
                if s.get('title') == close_matches[0]:
                    series = s
                    break
    
    if not series:
        log.warning(f"  ✗ Series not found in Sonarr: '{series_name}'")
        return False, None
    
    tvdb_id = series.get('tvdbId')
    if not tvdb_id:
        log.warning(f"  ✗ Cannot verify episodes: Series '{series.get('title')}' has no TVDB ID")
        return False, None
    
    # Get Plex TV shows and find the series
    def _get_plex_shows():
        plex = PlexServer(config.plex.url, config.plex.token, timeout=30)
        return plex.library.section(config.plex.tv_library_name).all()
    
    plex_shows, success = retry_with_backoff(
        _get_plex_shows,
        max_retries=3,
        logger_instance=log,
        operation_name="Get Plex TV shows for verification",
        raise_on_final_failure=False,
    )
    
    if not success or not plex_shows:
        log.warning(f"  ✗ Failed to get Plex TV shows - cannot verify episodes")
        return False, None
    
    # Find series in Plex by TVDB ID
    plex_series = None
    for show in plex_shows:
        plex_tvdb_id = get_tvdb_id_from_plex_series(show)
        if plex_tvdb_id == tvdb_id:
            plex_series = show
            break
    
    if not plex_series:
        log.warning(f"  ✗ Series not found in Plex (TVDB: {tvdb_id})")
        return False, None
    
    # Get all episodes from Plex for this series
    plex_episodes_set = get_plex_episodes_set(plex_series)
    if not plex_episodes_set:
        log.warning(f"  ✗ Series found in Plex but has no episodes")
        return False, None
    
    # Get all episodes for this series from Sonarr
    episodes = sonarr_get_episodes_by_series(config, series.get('id'))
    if not episodes:
        log.warning(f"  ✗ No episodes found for series '{series.get('title')}'")
        return False, None
    
    # Filter episodes for this season
    season_episodes = [ep for ep in episodes if ep.get('seasonNumber') == season_num]
    if not season_episodes:
        log.warning(f"  ✗ No episodes found for Season {season_num}")
        return False, None
    
    # Check if ALL season episodes are in Plex
    sonarr_season_episodes_set = set()
    for ep in season_episodes:
        season_num_ep = ep.get('seasonNumber')
        episode_num = ep.get('episodeNumber')
        if season_num_ep is not None and episode_num is not None:
            sonarr_season_episodes_set.add((int(season_num_ep), int(episode_num)))
    
    # Find missing episodes
    missing_episodes = sonarr_season_episodes_set - plex_episodes_set
    
    if missing_episodes:
        missing_list = sorted(missing_episodes)
        log.warning(f"  ✗ NOT ALL episodes in Season {season_num} are in Plex!")
        log.warning(f"  Missing episodes: {missing_list}")
        log.warning(f"  Only {len(sonarr_season_episodes_set) - len(missing_episodes)}/{len(sonarr_season_episodes_set)} episodes in Plex")
        return False, plex_series.title
    
    log.info(f"  ✓ All {len(sonarr_season_episodes_set)} episodes in Season {season_num} are confirmed in Plex")
    return True, plex_series.title


def unmonitor_season_in_sonarr(season_title: str, config, log) -> bool:
    """
    Unmonitor an entire season in Sonarr.
    Season title format: "Series Name - Season X" (e.g., "Last Week Tonight with John Oliver - Season 4")
    Returns True if season was unmonitored, False otherwise.
    """
    from tautulli_curated.helpers import sonarr_utils
    from tautulli_curated.helpers.sonarr_utils import (
        _sonarr_get_all_series,
        sonarr_get_episodes_by_series,
        sonarr_set_episode_monitored,
    )
    from tautulli_curated.helpers.sonarr_monitor_confirm import unmonitor_season_in_sonarr
    import re
    
    # Parse season title: "Series Name - Season X"
    if " - Season " not in season_title:
        log.warning(f"  ✗ Invalid season title format: '{season_title}' (expected 'Series Name - Season X')")
        return False
    
    series_name, season_part = season_title.split(" - Season ", 1)
    series_name = series_name.strip()
    season_part = season_part.strip()
    
    # Extract season number
    season_match = re.search(r'(\d+)', season_part)
    if not season_match:
        log.warning(f"  ✗ Could not extract season number from: '{season_part}'")
        return False
    
    season_num = int(season_match.group(1))
    
    log.info(f"  Parsed: Series='{series_name}', Season={season_num}")
    
    # Get all series from Sonarr
    log.info("  Connecting to Sonarr...")
    all_series = _sonarr_get_all_series(config)
    if not all_series:
        log.error("  ✗ Failed to fetch series from Sonarr")
        return False
    log.info(f"  ✓ Connected to Sonarr (found {len(all_series)} series)")
    
    # Find series by title (exact or fuzzy match)
    series = None
    for s in all_series:
        if s.get('title', '').lower() == series_name.lower():
            series = s
            break
    
    if not series:
        # Try fuzzy match
        import difflib
        titles = [s.get('title', '') for s in all_series]
        close_matches = difflib.get_close_matches(series_name, titles, n=1, cutoff=0.7)
        if close_matches:
            for s in all_series:
                if s.get('title') == close_matches[0]:
                    series = s
                    log.info(f"  ✓ Found series by fuzzy match: '{series.get('title')}'")
                    break
    
    if not series:
        log.warning(f"  ✗ Series not found in Sonarr: '{series_name}'")
        return False
    
    log.info(f"  ✓ Found series in Sonarr: '{series.get('title')}' (ID: {series.get('id')})")
    
    # Get all episodes for this series
    log.info("  Getting episodes from Sonarr...")
    episodes = sonarr_get_episodes_by_series(config, series.get('id'))
    if not episodes:
        log.warning(f"  ✗ No episodes found for series '{series.get('title')}'")
        return False
    
    # Filter episodes for this season
    season_episodes = [ep for ep in episodes if ep.get('seasonNumber') == season_num]
    if not season_episodes:
        log.warning(f"  ✗ No episodes found for Season {season_num}")
        return False
    
    log.info(f"  ✓ Found {len(season_episodes)} episodes in Season {season_num}")
    
    # SAFETY CHECK: Verify ALL episodes in this season are in Plex before unmonitoring
    log.info("  Checking if all episodes in this season are in Plex...")
    all_episodes_present, plex_series_title = verify_all_season_episodes_in_plex(
        series_name, season_num, config, log
    )
    
    if not all_episodes_present:
        log.warning(f"  ⚠ SKIPPING season unmonitor for safety (not all episodes in Plex)")
        return False
    
    # Check if any episodes are monitored
    monitored_episodes = [ep for ep in season_episodes if ep.get('monitored', False)]
    if not monitored_episodes:
        log.info(f"  ⚠ Season {season_num} already has all episodes unmonitored")
        return False
    
    log.info(f"  Found {len(monitored_episodes)} monitored episodes in Season {season_num}")
    
    # Unmonitor all monitored episodes in this season
    log.info(f"  Unmonitoring {len(monitored_episodes)} episodes in Season {season_num}...")
    unmonitored_count = 0
    for ep in monitored_episodes:
        success = sonarr_set_episode_monitored(config, ep, False)
        if success:
            unmonitored_count += 1
            season = ep.get('seasonNumber', 0)
            episode_num = ep.get('episodeNumber', 0)
            log.debug(f"    ✓ Unmonitored S{season:02d}E{episode_num:02d}")
    
    if unmonitored_count > 0:
        log.info(f"  ✓ Unmonitored {unmonitored_count} episodes in Season {season_num}")
    
    # Also unmonitor the season itself
    log.info(f"  Unmonitoring Season {season_num} itself...")
    season_unmonitored = unmonitor_season_in_sonarr(series, season_num, config, log, dry_run=False)
    
    if season_unmonitored:
        log.info(f"  ✓ Successfully unmonitored Season {season_num} in Sonarr")
        return True
    else:
        log.warning(f"  ⚠ Season {season_num} unmonitoring had issues, but episodes were unmonitored")
        return unmonitored_count > 0


def unmonitor_episode_in_sonarr(episode_title: str, config, log) -> bool:
    """
    Unmonitor an episode in Sonarr.
    Episode title format: "Series Name - Episode Title" (e.g., "Supernatural - Unity")
    Returns True if episode was unmonitored, False otherwise.
    """
    from tautulli_curated.helpers import sonarr_utils
    from tautulli_curated.helpers.sonarr_utils import (
        _sonarr_get_all_series,
        sonarr_get_episodes_by_series,
        sonarr_find_episode_by_series_and_episode,
        sonarr_set_episode_monitored,
    )
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    # Parse episode title: "Series Name - Episode Title"
    if " - " not in episode_title:
        log.warning(f"  ✗ Invalid episode title format: '{episode_title}' (expected 'Series Name - Episode Title')")
        return False
    
    series_name, ep_title = episode_title.split(" - ", 1)
    series_name = series_name.strip()
    ep_title = ep_title.strip()
    
    log.info(f"  Parsed: Series='{series_name}', Episode='{ep_title}'")
    
    # Get all series from Sonarr
    log.info("  Connecting to Sonarr...")
    all_series = _sonarr_get_all_series(config)
    if not all_series:
        log.error("  ✗ Failed to fetch series from Sonarr")
        return False
    log.info(f"  ✓ Connected to Sonarr (found {len(all_series)} series)")
    
    # Find series by title (exact or fuzzy match)
    series = None
    for s in all_series:
        if s.get('title', '').lower() == series_name.lower():
            series = s
            break
    
    if not series:
        # Try fuzzy match
        import difflib
        titles = [s.get('title', '') for s in all_series]
        close_matches = difflib.get_close_matches(series_name, titles, n=1, cutoff=0.7)
        if close_matches:
            for s in all_series:
                if s.get('title') == close_matches[0]:
                    series = s
                    log.info(f"  ✓ Found series by fuzzy match: '{series.get('title')}'")
                    break
    
    if not series:
        log.warning(f"  ✗ Series not found in Sonarr: '{series_name}'")
        return False
    
    log.info(f"  ✓ Found series in Sonarr: '{series.get('title')}' (ID: {series.get('id')})")
    
    # Get all episodes for this series
    log.info("  Getting episodes from Sonarr...")
    episodes = sonarr_get_episodes_by_series(config, series.get('id'))
    if not episodes:
        log.warning(f"  ✗ No episodes found for series '{series.get('title')}'")
        return False
    
    log.info(f"  ✓ Found {len(episodes)} episodes")
    
    # Find episode by title (exact or fuzzy match)
    episode = None
    for ep in episodes:
        ep_title_sonarr = ep.get('title', '').strip()
        if ep_title_sonarr.lower() == ep_title.lower():
            episode = ep
            break
    
    if not episode:
        # Try fuzzy match
        import difflib
        ep_titles = [ep.get('title', '').strip() for ep in episodes]
        close_matches = difflib.get_close_matches(ep_title, ep_titles, n=1, cutoff=0.7)
        if close_matches:
            for ep in episodes:
                if ep.get('title', '').strip() == close_matches[0]:
                    episode = ep
                    log.info(f"  ✓ Found episode by fuzzy match: '{episode.get('title')}'")
                    break
    
    if not episode:
        log.warning(f"  ✗ Episode not found in Sonarr: '{ep_title}'")
        log.debug(f"  Available episodes: {[ep.get('title') for ep in episodes[:10]]}")
        return False
    
    season = episode.get('seasonNumber', 0)
    episode_num = episode.get('episodeNumber', 0)
    log.info(f"  ✓ Found episode: S{season:02d}E{episode_num:02d} - '{episode.get('title')}'")
    
    # Check if already unmonitored
    if not episode.get('monitored', False):
        log.info(f"  ⚠ Episode S{season:02d}E{episode_num:02d} is already unmonitored")
        return False
    
    # Unmonitor the episode
    log.info(f"  Unmonitoring episode S{season:02d}E{episode_num:02d}...")
    success = sonarr_set_episode_monitored(config, episode, False)
    
    if success:
        log.info(f"  ✓ Successfully unmonitored S{season:02d}E{episode_num:02d} in Sonarr")
        return True
    else:
        log.warning(f"  ✗ Failed to unmonitor episode S{season:02d}E{episode_num:02d}")
        return False


def run_unmonitor_media_after_download(movie_title: str, media_type: str = "movie", config=None, log_parent=None):
    """
    Main function to unmonitor movie in Radarr or episode/season in Sonarr and remove from watchlist.
    Returns (radarr_unmonitored, watchlist_removed) for movies, 
            (sonarr_unmonitored, watchlist_removed) for seasons, 
            or (sonarr_unmonitored, False) for episodes
    """
    log = log_parent or logger
    config = config or load_config()

    log.info("=" * 60)
    log.info("UNMONITOR MEDIA AFTER DOWNLOAD START")
    log.info("=" * 60)
    log.info(f"Title: {movie_title}")
    log.info(f"Media type: {media_type}")
    log.info("")

    if media_type.lower() == "episode":
        log.info("Step 1: Unmonitoring episode in Sonarr...")
        sonarr_unmonitored = unmonitor_episode_in_sonarr(movie_title, config, log)
        
        if sonarr_unmonitored:
            log.info(f"  ✓ Episode successfully unmonitored in Sonarr")
        else:
            log.warning(f"  ✗ Episode not found in Sonarr or already unmonitored")
        
        log.info("")
        log.info("=" * 60)
        log.info("UNMONITOR SONARR AFTER DOWNLOAD SUMMARY")
        log.info("=" * 60)
        log.info(f"Episode: {movie_title}")
        log.info(f"Sonarr Unmonitored: {'✓ Yes' if sonarr_unmonitored else '✗ No (already unmonitored or not found)'}")
        log.info("=" * 60)
        
        return sonarr_unmonitored, False  # No watchlist removal for episodes
    
    if media_type.lower() == "season":
        log.info("Step 1: Unmonitoring season in Sonarr...")
        sonarr_unmonitored = unmonitor_season_in_sonarr(movie_title, config, log)
        
        if sonarr_unmonitored:
            log.info(f"  ✓ Season successfully unmonitored in Sonarr")
        else:
            log.warning(f"  ✗ Season not found in Sonarr or already unmonitored")
        
        log.info("")
        log.info("Step 2: Removing TV show from Plex watchlist...")
        # Extract series name and season number from season title (format: "Series Name - Season X")
        if " - Season " in movie_title:
            series_name = movie_title.split(" - Season ")[0].strip()
            import re
            season_part = movie_title.split(" - Season ", 1)[1].strip()
            season_match = re.search(r'(\d+)', season_part)
            season_num = int(season_match.group(1)) if season_match else None
        else:
            series_name = movie_title
            season_num = None
        
        # SAFETY CHECK: Verify ALL episodes in this season are in Plex before removing from watchlist
        if season_num is not None:
            log.info("  Verifying all episodes are in Plex before removing from watchlist...")
            all_episodes_present, plex_series_title = verify_all_season_episodes_in_plex(
                series_name, season_num, config, log
            )
            
            if not all_episodes_present:
                log.warning(f"  ✗ NOT ALL episodes in Season {season_num} are in Plex!")
                log.warning(f"  ⚠ SKIPPING watchlist removal for safety (not all episodes downloaded)")
                watchlist_removed = False
            else:
                log.info(f"  ✓ All episodes confirmed in Plex - proceeding with watchlist removal")
                watchlist_removed = remove_show_from_plex_watchlist_with_retry(
                    config,
                    series_name,
                    log
                )
        else:
            # Fallback: if we can't parse season number, skip watchlist removal for safety
            log.warning(f"  ⚠ Could not parse season number from '{movie_title}' - skipping watchlist removal for safety")
            watchlist_removed = False
        
        if watchlist_removed:
            log.info(f"  ✓ TV show successfully removed from Plex watchlist")
        else:
            log.info(f"  ⚠ TV show was not removed from watchlist (not all episodes in Plex or not in watchlist)")
        
        log.info("")
        log.info("=" * 60)
        log.info("UNMONITOR SONARR AFTER DOWNLOAD SUMMARY")
        log.info("=" * 60)
        log.info(f"Season: {movie_title}")
        log.info(f"Sonarr Unmonitored: {'✓ Yes' if sonarr_unmonitored else '✗ No (already unmonitored or not found)'}")
        log.info(f"Watchlist Removed: {'✓ Yes' if watchlist_removed else '✗ No (not in watchlist or already removed)'}")
        log.info("=" * 60)
        
        return sonarr_unmonitored, watchlist_removed
    
    # Movie processing (existing logic)
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
    log.info("UNMONITOR MEDIA AFTER DOWNLOAD SUMMARY")
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
        print('Usage: python3 unmonitor_media_after_download.py "Title" [media_type]')
        print('  Title: Movie title, "Series Name - Episode Title" for episodes, or "Series Name - Season X" for seasons')
        print('  media_type: "movie", "episode", or "season" (default: "movie")')
        print('  Examples:')
        print('    python3 unmonitor_media_after_download.py "Supernatural - Unity" episode')
        print('    python3 unmonitor_media_after_download.py "Last Week Tonight with John Oliver - Season 4" season')
        return 1
    
    movie_title = sys.argv[1]
    media_type = sys.argv[2].lower().strip() if len(sys.argv) > 2 else "movie"
    
    logger.info("=" * 60)
    logger.info("UNMONITOR MEDIA AFTER DOWNLOAD SCRIPT")
    logger.info("=" * 60)
    logger.info(f"Title: {movie_title}")
    logger.info(f"Media type: {media_type}")
    logger.info("")
    
    # Check if media type is supported (movie, episode, or season)
    if media_type not in ("movie", "episode", "season"):
        logger.info(f"Media type '{media_type}' is not 'movie', 'episode', or 'season' - skipping processing")
        logger.info("  Note: Only 'movie', 'episode', and 'season' media types are currently supported")
        logger.info("")
        logger.info("=" * 60)
        logger.info("UNMONITOR MEDIA AFTER DOWNLOAD END (skipped)")
        logger.info("=" * 60)
        return 0
    
    try:
        config = load_config()
        radarr_unmonitored, watchlist_removed = run_unmonitor_media_after_download(
            movie_title=movie_title,
            media_type=media_type,
            config=config
        )
        
        logger.info("")
        logger.info("=" * 60)
        if media_type == "episode":
            if radarr_unmonitored:
                logger.info("UNMONITOR MEDIA AFTER DOWNLOAD END OK (Sonarr - Episode)")
            else:
                logger.info("UNMONITOR MEDIA AFTER DOWNLOAD END (no changes needed - Sonarr - Episode)")
        elif media_type == "season":
            if radarr_unmonitored or watchlist_removed:
                logger.info("UNMONITOR MEDIA AFTER DOWNLOAD END OK (Sonarr - Season)")
            else:
                logger.info("UNMONITOR MEDIA AFTER DOWNLOAD END (no changes needed - Sonarr - Season)")
        else:
            if radarr_unmonitored or watchlist_removed:
                logger.info("UNMONITOR MEDIA AFTER DOWNLOAD END OK (Radarr)")
            else:
                logger.info("UNMONITOR MEDIA AFTER DOWNLOAD END (no changes needed - Radarr)")
        logger.info("=" * 60)
        
        return 0
    except KeyboardInterrupt:
        logger.warning("")
        logger.warning("Script interrupted by user")
        logger.info("=" * 60)
        logger.info("UNMONITOR MEDIA AFTER DOWNLOAD END (interrupted)")
        logger.info("=" * 60)
        return 130
    except Exception as e:
        logger.exception("")
        logger.error("=" * 60)
        logger.error("UNMONITOR MEDIA AFTER DOWNLOAD END FAIL")
        logger.error("=" * 60)
        return 1


if __name__ == "__main__":
    sys.exit(main())

