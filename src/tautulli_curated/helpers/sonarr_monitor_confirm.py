#!/usr/bin/env python3
"""
Sonarr Monitor Confirm Helper

Checks monitored series and episodes in Sonarr; if an episode already exists in Plex,
unmonitor that episode in Sonarr. If any episode is missing from Plex, keep the series
monitored.
"""

import sys
from pathlib import Path
from typing import Set, Tuple, Optional

# Add project root to Python path for imports
_script_dir = Path(__file__).resolve().parent
_project_root = None
_current = _script_dir
for _ in range(5):  # Go up max 5 levels
    if (_current / "config" / "config.yaml").exists():
        _project_root = _current
        break
    _current = _current.parent

if _project_root is None:
    _project_root = _script_dir.parent.parent.parent

_src_path = _project_root / "src"
if str(_src_path) not in sys.path:
    sys.path.insert(0, str(_src_path))

from plexapi.server import PlexServer
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers import sonarr_utils
from tautulli_curated.helpers.sonarr_utils import (
    sonarr_get_episodes_by_series,
    sonarr_find_series_by_tvdb_id,
    sonarr_set_episode_monitored,
)
from tautulli_curated.helpers.retry_utils import retry_with_backoff

logger = setup_logger("sonarr_monitor_confirm")


def get_sonarr_monitored_series(config, log):
    """Get all monitored series from Sonarr with retry logic."""
    series = sonarr_utils._sonarr_get_all_series(config)
    monitored = [s for s in series if s.get('monitored', False)]
    log.info(f"Found {len(monitored)} monitored series in Sonarr")
    return monitored


def get_plex_tv_shows(config, log):
    """Get all TV shows from Plex library with retry logic."""
    def _get_shows():
        plex = PlexServer(config.plex.url, config.plex.token, timeout=30)
        return plex.library.section(config.plex.tv_library_name).all()
    
    shows, success = retry_with_backoff(
        _get_shows,
        max_retries=3,
        logger_instance=log,
        operation_name="Get Plex TV shows",
        raise_on_final_failure=False,
    )
    
    return shows if success else []


def get_tvdb_id_from_plex_series(series) -> Optional[int]:
    """Extract TVDB ID from Plex series GUIDs."""
    try:
        guids = getattr(series, "guids", []) or []
        for guid in guids:
            guid_id = getattr(guid, "id", "") or str(guid)
            if "tvdb" in guid_id.lower():
                import re
                match = re.search(r'(\d+)', guid_id)
                if match:
                    return int(match.group(1))
    except Exception as e:
        logger.debug(f"Error extracting TVDB ID from Plex series {series.title}: {e}")
    
    return None


def get_plex_episodes_set(plex_series) -> Set[Tuple[int, int]]:
    """
    Get set of (season, episode) tuples from Plex series.
    
    Returns:
        Set of (season_number, episode_number) tuples
    """
    episodes_set = set()
    try:
        episodes = plex_series.episodes()
        for episode in episodes:
            season = getattr(episode, "seasonNumber", None) or getattr(episode, "parentIndex", None)
            episode_num = getattr(episode, "episodeNumber", None) or getattr(episode, "index", None)
            if season is not None and episode_num is not None:
                episodes_set.add((int(season), int(episode_num)))
    except Exception as e:
        logger.warning(f"Error getting episodes from Plex series {plex_series.title}: {e}")
    
    return episodes_set


def find_plex_series_by_tvdb_id(plex_shows, tvdb_id: int, log):
    """Find a Plex series by TVDB ID."""
    log.debug(f"  Searching for TVDB ID {tvdb_id} in {len(plex_shows)} Plex shows...")
    for show in plex_shows:
        plex_tvdb_id = get_tvdb_id_from_plex_series(show)
        if plex_tvdb_id == tvdb_id:
            log.info(f"  ✓ Found match in Plex: '{show.title}' (TVDB: {plex_tvdb_id})")
            return show
        elif plex_tvdb_id:
            log.debug(f"  Plex show '{show.title}' has TVDB ID {plex_tvdb_id} (not matching {tvdb_id})")
    log.warning(f"  ✗ No Plex series found with TVDB ID {tvdb_id}")
    return None


def unmonitor_episode_in_sonarr(episode, config, log, dry_run=False) -> bool:
    """Unmonitor an episode in Sonarr if it's currently monitored."""
    if not episode.get("monitored", False):
        return False  # Already unmonitored
    
    if dry_run:
        log.info(f"  [DRY RUN] Would unmonitor S{episode.get('seasonNumber', 0):02d}E{episode.get('episodeNumber', 0):02d}")
        return True
    
    success = sonarr_set_episode_monitored(config, episode, False)
    if success:
        log.info(f"  Unmonitored S{episode.get('seasonNumber', 0):02d}E{episode.get('episodeNumber', 0):02d}")
    else:
        log.warning(f"  Failed to unmonitor S{episode.get('seasonNumber', 0):02d}E{episode.get('episodeNumber', 0):02d}")
    
    return success


def unmonitor_season_in_sonarr(sonarr_series, season_num: int, config, log, dry_run=False) -> bool:
    """Unmonitor a season in Sonarr by updating the series object."""
    import requests
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    # Get the series with its seasons array
    series_id = sonarr_series.get("id")
    seasons = sonarr_series.get("seasons", [])
    
    # Find the season to unmonitor
    season_to_update = None
    for season in seasons:
        if season.get("seasonNumber") == season_num:
            season_to_update = season
            break
    
    if not season_to_update:
        log.warning(f"  Season {season_num} not found in series seasons array")
        return False
    
    # Check if already unmonitored
    if not season_to_update.get("monitored", False):
        log.debug(f"  Season {season_num} already unmonitored")
        return True
    
    if dry_run:
        log.info(f"  [DRY RUN] Would unmonitor Season {season_num}")
        return True
    
    # Update the season's monitored status
    season_to_update["monitored"] = False
    
    # Update the series with the modified seasons array
    updated_series = dict(sonarr_series)
    updated_series["seasons"] = seasons
    
    def _update_series():
        r = requests.put(
            f"{config.sonarr.url.rstrip('/')}/api/v3/series/{series_id}",
            json=updated_series,
            headers={"X-Api-Key": config.sonarr.api_key},
            timeout=60,
        )
        r.raise_for_status()
        return True
    
    log.info(f"  Unmonitoring Season {season_num} in Sonarr...")
    _, success = retry_with_backoff(
        _update_series,
        max_retries=3,
        logger_instance=log,
        operation_name=f"Unmonitor Season {season_num}",
        raise_on_final_failure=False,
    )
    
    if success:
        log.info(f"  ✓ Successfully unmonitored Season {season_num}")
    else:
        log.warning(f"  ✗ Failed to unmonitor Season {season_num}")
    
    return success


def process_series(sonarr_series, plex_shows, config, log, dry_run=False):
    """
    Process a single series with granular unmonitoring:
    1. Unmonitor individual episodes if they exist in Plex
    2. If ALL episodes of a season are in Plex, unmonitor all episodes in that season
    3. If ALL seasons are complete (all episodes in Plex), unmonitor the series
    
    Returns:
        Tuple of (episodes_checked, episodes_in_plex, episodes_unmonitored, has_missing, missing_count)
    """
    from collections import defaultdict
    
    series_title = sonarr_series.get("title", "Unknown")
    tvdb_id = sonarr_series.get("tvdbId")
    series_id = sonarr_series.get("id")
    
    log.info("")
    log.info("=" * 80)
    log.info(f"Processing series: {series_title}")
    log.info(f"  Sonarr ID: {series_id}, TVDB ID: {tvdb_id}")
    
    if not tvdb_id:
        log.warning(f"  ✗ Skipping series '{series_title}': no TVDB ID in Sonarr")
        return 0, 0, 0, True, 0  # Treat as missing to keep monitored
    
    # Find series in Plex
    plex_series = find_plex_series_by_tvdb_id(plex_shows, tvdb_id, log)
    if not plex_series:
        log.warning(f"  ✗ Series '{series_title}' (TVDB: {tvdb_id}) NOT FOUND in Plex - keeping all episodes monitored")
        return 0, 0, 0, True, 0  # Not in Plex, keep monitored
    
    # Get episodes from Plex
    log.info(f"  Getting episodes from Plex series '{plex_series.title}'...")
    plex_episodes = get_plex_episodes_set(plex_series)
    if not plex_episodes:
        log.warning(f"  ✗ Series '{series_title}' found in Plex but has no episodes - keeping all episodes monitored")
        return 0, 0, 0, True, 0  # No episodes in Plex, keep monitored
    
    log.info(f"  ✓ Found {len(plex_episodes)} episodes in Plex")
    
    # Get episodes from Sonarr
    log.info(f"  Getting episodes from Sonarr...")
    sonarr_episodes = sonarr_get_episodes_by_series(config, series_id)
    if not sonarr_episodes:
        log.warning(f"  ✗ Series '{series_title}' has no episodes in Sonarr")
        return 0, 0, 0, False, 0
    
    # Count monitored episodes in Sonarr
    monitored_episodes = [ep for ep in sonarr_episodes if ep.get("monitored", False)]
    log.info(f"  ✓ Found {len(sonarr_episodes)} total episodes in Sonarr ({len(monitored_episodes)} monitored)")
    
    # Group episodes by season for granular processing
    episodes_by_season = defaultdict(list)
    for sonarr_ep in sonarr_episodes:
        season = sonarr_ep.get("seasonNumber")
        if season is not None:
            episodes_by_season[int(season)].append(sonarr_ep)
    
    log.info(f"  ✓ Found {len(episodes_by_season)} seasons in Sonarr")
    
    episodes_checked = 0
    episodes_in_plex = 0
    episodes_unmonitored = 0
    episodes_already_unmonitored = 0
    has_missing = False
    missing_episodes = []
    seasons_unmonitored = 0
    seasons_complete = []
    seasons_incomplete = []
    
    # Process each season
    log.info("")
    log.info("  Processing by season:")
    for season_num in sorted(episodes_by_season.keys()):
        season_episodes = episodes_by_season[season_num]
        season_monitored = [ep for ep in season_episodes if ep.get("monitored", False)]
        
        # Process all seasons, not just those with monitored episodes
        # (to check completeness and unmonitor episodes that are in Plex)
        
        log.info(f"    Season {season_num}: {len(season_episodes)} total episodes ({len(season_monitored)} monitored)")
        
        # Check each episode in this season
        season_episodes_in_plex = 0
        season_episodes_missing = []
        season_episodes_to_unmonitor = []
        
        for sonarr_ep in season_episodes:
            episodes_checked += 1
            season = sonarr_ep.get("seasonNumber")
            episode_num = sonarr_ep.get("episodeNumber")
            is_monitored = sonarr_ep.get("monitored", False)
            
            if season is None or episode_num is None:
                continue
            
            episode_key = (int(season), int(episode_num))
            ep_str = f"S{season:02d}E{episode_num:02d}"
            
            # Check if episode exists in Plex
            if episode_key in plex_episodes:
                episodes_in_plex += 1
                season_episodes_in_plex += 1
                if is_monitored:
                    season_episodes_to_unmonitor.append(sonarr_ep)
                    log.info(f"      ✓ {ep_str} - Found in Plex, MONITORED -> will unmonitor")
                else:
                    episodes_already_unmonitored += 1
                    log.debug(f"      ✓ {ep_str} - Found in Plex, already UNMONITORED")
            else:
                has_missing = True
                missing_episodes.append(ep_str)
                season_episodes_missing.append(ep_str)
                if is_monitored:
                    log.warning(f"      ✗ {ep_str} - MISSING from Plex (MONITORED - keeping monitored)")
        
        # Check if season is complete (all episodes in Plex)
        if len(season_episodes_missing) == 0:
            # All episodes of this season are in Plex
            seasons_complete.append(season_num)
            log.info(f"    ✓ Season {season_num}: ALL {len(season_episodes)} episodes found in Plex")
            
            # Unmonitor all monitored episodes in this season
            if season_episodes_to_unmonitor:
                log.info(f"      → Unmonitoring {len(season_episodes_to_unmonitor)} monitored episodes in Season {season_num}")
                for ep in season_episodes_to_unmonitor:
                    if unmonitor_episode_in_sonarr(ep, config, log, dry_run):
                        episodes_unmonitored += 1
                seasons_unmonitored += 1
            
            # Unmonitor the season itself
            log.info(f"      → Unmonitoring Season {season_num} itself")
            if unmonitor_season_in_sonarr(sonarr_series, season_num, config, log, dry_run):
                log.info(f"      ✓ Season {season_num} unmonitored")
            else:
                log.warning(f"      ✗ Failed to unmonitor Season {season_num}")
        else:
            # Season has missing episodes
            seasons_incomplete.append(season_num)
            log.warning(f"    ✗ Season {season_num}: {len(season_episodes_missing)} missing episodes ({season_episodes_in_plex}/{len(season_episodes)} in Plex)")
            
            # Still unmonitor individual episodes that ARE in Plex
            if season_episodes_to_unmonitor:
                log.info(f"      → Unmonitoring {len(season_episodes_to_unmonitor)} episodes that ARE in Plex")
                for ep in season_episodes_to_unmonitor:
                    if unmonitor_episode_in_sonarr(ep, config, log, dry_run):
                        episodes_unmonitored += 1
    
    # Check if entire series is complete (all episodes in Plex)
    series_complete = len(seasons_incomplete) == 0 and len(seasons_complete) > 0
    
    # Unmonitor series if all seasons are complete
    if series_complete:
        log.info("")
        log.info(f"  ✓ ALL SEASONS COMPLETE - Unmonitoring series '{series_title}'")
        if dry_run:
            log.info(f"    [DRY RUN] Would unmonitor series")
        else:
            from tautulli_curated.helpers.sonarr_utils import sonarr_set_monitored
            success = sonarr_set_monitored(config, sonarr_series, False)
            if success:
                log.info(f"    ✓ Successfully unmonitored series")
            else:
                log.warning(f"    ✗ Failed to unmonitor series")
    
    # Summary for this series
    log.info("")
    log.info(f"  SERIES SUMMARY: {series_title}")
    log.info(f"    Total episodes checked: {episodes_checked}")
    log.info(f"    Episodes found in Plex: {episodes_in_plex}")
    log.info(f"    Episodes unmonitored this run: {episodes_unmonitored}")
    log.info(f"    Episodes already unmonitored: {episodes_already_unmonitored}")
    log.info(f"    Complete seasons: {len(seasons_complete)} ({', '.join(f'S{s}' for s in sorted(seasons_complete)) if seasons_complete else 'none'})")
    log.info(f"    Incomplete seasons: {len(seasons_incomplete)} ({', '.join(f'S{s}' for s in sorted(seasons_incomplete)) if seasons_incomplete else 'none'})")
    if has_missing:
        log.warning(f"    ⚠ Missing episodes from Plex: {len(missing_episodes)}")
        log.warning(f"      Missing: {', '.join(missing_episodes[:20])}{'...' if len(missing_episodes) > 20 else ''}")
        log.warning(f"    → Series will remain MONITORED (has {len(missing_episodes)} missing episodes)")
    else:
        log.info(f"    ✓ All episodes found in Plex")
        if series_complete:
            log.info(f"    → Series unmonitored (all seasons complete)")
        elif episodes_unmonitored > 0:
            log.info(f"    → Unmonitored {episodes_unmonitored} episodes that were in Plex")
    log.info("=" * 80)
    
    return episodes_checked, episodes_in_plex, episodes_unmonitored, has_missing, len(missing_episodes)


def run_sonarr_monitor_confirm(config=None, dry_run=False, log_parent=None):
    """
    Check monitored series and episodes in Sonarr and unmonitor episodes that exist in Plex.
    If any episode is missing from Plex, keep the series monitored.
    
    Returns:
        Tuple of (total_series, total_episodes_checked, episodes_in_plex, episodes_unmonitored, series_with_missing)
    """
    log = log_parent or logger
    
    if config is None:
        config = load_config()
    
    log.info("Starting Sonarr monitor confirmation...")
    log.info(f"Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    
    # Get monitored series from Sonarr
    monitored_series = get_sonarr_monitored_series(config, log)
    if not monitored_series:
        log.info("No monitored series found in Sonarr")
        return 0, 0, 0, 0, 0
    
    # Get all TV shows from Plex
    plex_shows = get_plex_tv_shows(config, log)
    log.info(f"Found {len(plex_shows)} TV shows in Plex")
    
    # Log some Plex show titles for debugging
    log.debug(f"Sample Plex shows: {[s.title for s in plex_shows[:10]]}")
    
    total_series = len(monitored_series)
    log.info(f"Processing {total_series} monitored series from Sonarr...")
    total_episodes_checked = 0
    total_episodes_in_plex = 0
    total_episodes_unmonitored = 0
    series_with_missing = 0
    
    # Process each monitored series
    series_not_found_in_plex = []
    series_still_monitored = []  # List of (title, reason, monitored_count)
    for idx, sonarr_series in enumerate(monitored_series, 1):
        try:
            log.info(f"\n[{idx}/{total_series}] Processing: {sonarr_series.get('title', 'Unknown')}")
            checked, in_plex, unmonitored, has_missing, missing_count = process_series(
                sonarr_series, plex_shows, config, log, dry_run
            )
            total_episodes_checked += checked
            total_episodes_in_plex += in_plex
            total_episodes_unmonitored += unmonitored
            if has_missing:
                series_with_missing += 1
            if checked == 0 and in_plex == 0:
                # Series not found in Plex
                series_not_found_in_plex.append(sonarr_series.get('title', 'Unknown'))
            
            # Check if series still has monitored episodes (only if we actually processed episodes)
            if checked > 0:
                sonarr_episodes = sonarr_get_episodes_by_series(config, sonarr_series.get('id'))
                monitored_count = sum(1 for ep in sonarr_episodes if ep.get('monitored', False))
                if monitored_count > 0:
                    if has_missing:
                        reason = f"Has {missing_count} missing episodes from Plex"
                    else:
                        reason = "Unknown reason (episodes checked but still monitored)"
                    series_still_monitored.append((sonarr_series.get('title', 'Unknown'), reason, monitored_count))
        except Exception as e:
            log.error(f"Error processing series '{sonarr_series.get('title', 'Unknown')}': {e}")
            import traceback
            log.error(traceback.format_exc())
            continue
    
    if series_not_found_in_plex:
        log.info("")
        log.warning("Series NOT FOUND in Plex (kept monitored):")
        for title in series_not_found_in_plex:
            log.warning(f"  - {title}")
    
    if series_still_monitored:
        log.info("")
        log.warning("=" * 80)
        log.warning("SERIES STILL WITH MONITORED EPISODES:")
        log.warning("=" * 80)
        for title, reason, count in sorted(series_still_monitored):
            log.warning(f"  • {title}")
            log.warning(f"    Reason: {reason}")
            log.warning(f"    Monitored episodes remaining: {count}")
        log.warning("=" * 80)
    
    log.info("")
    log.info("=" * 60)
    log.info("SUMMARY")
    log.info("=" * 60)
    log.info(f"Total monitored series: {total_series}")
    log.info(f"Total episodes checked: {total_episodes_checked}")
    log.info(f"Episodes found in Plex: {total_episodes_in_plex}")
    if dry_run:
        log.info(f"Would unmonitor: {total_episodes_unmonitored}")
    else:
        log.info(f"Episodes unmonitored: {total_episodes_unmonitored}")
    log.info(f"Series with missing episodes (kept monitored): {series_with_missing}")
    log.info("=" * 60)
    
    return total_series, total_episodes_checked, total_episodes_in_plex, total_episodes_unmonitored, series_with_missing


if __name__ == "__main__":
    # Allow running as standalone script
    import argparse
    
    parser = argparse.ArgumentParser(description="Check Sonarr monitored episodes against Plex")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without actually unmonitoring")
    args = parser.parse_args()
    
    try:
        total_series, episodes_checked, episodes_in_plex, episodes_unmonitored, series_with_missing = run_sonarr_monitor_confirm(
            dry_run=args.dry_run
        )
        print(f"\nProcessed {total_series} series, checked {episodes_checked} episodes")
        print(f"Found {episodes_in_plex} episodes in Plex")
        if args.dry_run:
            print(f"Would unmonitor: {episodes_unmonitored}")
        else:
            print(f"Unmonitored: {episodes_unmonitored}")
        print(f"Series with missing episodes: {series_with_missing}")
    except KeyboardInterrupt:
        print("\nScript interrupted by user", file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

