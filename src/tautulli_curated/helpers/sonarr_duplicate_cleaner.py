#!/usr/bin/env python3
"""
Sonarr Duplicate Episode Cleaner Helper

Checks for duplicate episodes in Plex (using series duplicate flag) and deletes the lower quality version.
Also unmonitors the episode in Sonarr after deletion.
"""

import sys
from pathlib import Path

# Add project root to Python path for imports
# This allows the script to be run standalone or from different directories
_script_dir = Path(__file__).resolve().parent
# Try to find project root by looking for config/ directory
_project_root = None
_current = _script_dir
for _ in range(5):  # Go up max 5 levels
    if (_current / "config" / "config.yaml").exists():
        _project_root = _current
        break
    _current = _current.parent

# Fallback to relative path if config not found
if _project_root is None:
    _project_root = _script_dir.parent.parent.parent  # helpers/ -> tautulli_curated/ -> src/ -> project root

# Add src directory to Python path
_src_path = _project_root / "src"
if str(_src_path) not in sys.path:
    sys.path.insert(0, str(_src_path))

import requests
from plexapi.server import PlexServer
from collections import defaultdict
from typing import Dict, List, Tuple, Optional
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.sonarr_utils import (
    sonarr_find_series_by_tvdb_id,
    sonarr_find_episode_by_series_and_episode,
    unmonitor_sonarr_episode_if_monitored,
)

logger = setup_logger("sonarr_duplicate_cleaner")


def get_plex_tv_shows(config):
    """Get all TV shows from Plex library with retry logic."""
    from tautulli_curated.helpers.retry_utils import retry_with_backoff
    
    def _get_shows():
        plex = PlexServer(config.plex.url, config.plex.token, timeout=30)
        return plex.library.section(config.plex.tv_library_name).all()
    
    shows, success = retry_with_backoff(
        _get_shows,
        max_retries=3,
        logger_instance=logger,
        operation_name="Get Plex TV shows",
        raise_on_final_failure=False,
    )
    
    return shows if success else []


def get_series_with_duplicate_flag(series_list):
    """
    Filter series that have duplicate flag set in Plex.
    
    Note: Plex API may use different attributes to indicate duplicates.
    We check for series that have duplicate episodes by examining the series metadata.
    """
    duplicate_series = []
    
    for series in series_list:
        # Check if series has duplicate attribute (Plex API may vary)
        # Also check if series has episodes with multiple media parts
        try:
            # Get all episodes for this series
            episodes = series.episodes()
            
            # Check if any episode has multiple media parts (indicating duplicates)
            has_duplicates = False
            for episode in episodes:
                media_parts = getattr(episode, "media", []) or []
                if len(media_parts) > 1:
                    has_duplicates = True
                    break
                # Also check if media has multiple parts
                for media in media_parts:
                    parts = getattr(media, "parts", []) or []
                    if len(parts) > 1:
                        has_duplicates = True
                        break
                if has_duplicates:
                    break
            
            if has_duplicates:
                duplicate_series.append(series)
        except Exception as e:
            logger.debug(f"Error checking series {series.title}: {e}")
            continue
    
    return duplicate_series


def get_episode_key(episode) -> str:
    """Generate unique key for episode: series_key + season + episode."""
    series_key = getattr(episode, "parentKey", "") or getattr(episode, "grandparentKey", "")
    season = getattr(episode, "seasonNumber", 0) or getattr(episode, "parentIndex", 0)
    episode_num = getattr(episode, "episodeNumber", 0) or getattr(episode, "index", 0)
    return f"{series_key}_S{season:02d}E{episode_num:02d}"


def find_duplicate_episodes(series):
    """
    Find episodes with multiple copies within a series.
    
    Returns:
        Dictionary: {episode_key: [list of episode media objects with file info]}
    """
    duplicates = defaultdict(list)
    
    try:
        episodes = series.episodes()
        
        for episode in episodes:
            media_list = getattr(episode, "media", []) or []
            
            # Check if episode has multiple media items or multiple parts
            all_media_parts = []
            
            for media in media_list:
                parts = getattr(media, "parts", []) or []
                for part in parts:
                    if hasattr(part, "file") and part.file:
                        all_media_parts.append({
                            'episode': episode,
                            'media': media,
                            'part': part,
                            'file': part.file,
                            'size': getattr(part, "size", 0),
                            'quality': getattr(media, "videoResolution", ""),
                            'added_at': getattr(episode, "addedAt", None),
                        })
            
            # If episode has multiple media parts, it's a duplicate
            if len(all_media_parts) > 1:
                episode_key = get_episode_key(episode)
                duplicates[episode_key] = all_media_parts
                logger.debug(f"Found duplicate episode: {series.title} - {episode_key} ({len(all_media_parts)} copies)")
    
    except Exception as e:
        logger.warning(f"Error finding duplicates in series {series.title}: {e}")
    
    return dict(duplicates)


def get_resolution_priority(resolution: str) -> int:
    """
    Convert resolution string to numeric priority.
    Lower number = worse quality (will be deleted first).
    
    Returns:
        int: Priority (1=worst, 4=best)
    """
    if not resolution:
        return 1  # Unknown resolution = worst
    
    resolution_lower = str(resolution).lower().strip()
    
    # Check for 4K/2160p
    if "4k" in resolution_lower or "2160" in resolution_lower:
        return 4
    
    # Check for 1080p
    if "1080" in resolution_lower:
        return 3
    
    # Check for 720p
    if "720" in resolution_lower:
        return 2
    
    # Check for 480p
    if "480" in resolution_lower:
        return 1
    
    # Default to worst if unknown
    return 1


def sort_episodes_by_quality(episodes: List[Dict]) -> List[Dict]:
    """
    Sort episodes by resolution quality (worst first).
    
    Args:
        episodes: List of episode media dicts with 'quality' key
    
    Returns:
        Sorted list with worst quality first
    """
    def sort_key(ep):
        quality = ep.get('quality', '')
        priority = get_resolution_priority(quality)
        # Secondary sort by file size (smaller = worse, if same resolution)
        size = ep.get('size', 0)
        return (priority, size)
    
    return sorted(episodes, key=sort_key)


def get_tvdb_id_from_series(series) -> Optional[int]:
    """Extract TVDB ID from series GUIDs."""
    try:
        guids = getattr(series, "guids", []) or []
        for guid in guids:
            guid_id = getattr(guid, "id", "") or str(guid)
            if "tvdb" in guid_id.lower():
                # Extract TVDB ID from guid (format may vary: "tvdb://12345" or similar)
                import re
                match = re.search(r'(\d+)', guid_id)
                if match:
                    return int(match.group(1))
    except Exception as e:
        logger.debug(f"Error extracting TVDB ID from series {series.title}: {e}")
    
    return None


def process_duplicate_episodes(duplicates: Dict[str, List[Dict]], config, log) -> int:
    """
    Process and delete duplicate episode files.
    
    Args:
        duplicates: Dictionary of {episode_key: [list of media parts]}
        config: Configuration object
        log: Logger instance
    
    Returns:
        int: Number of files deleted
    """
    deleted_files = 0
    
    for episode_key, media_parts in duplicates.items():
        if len(media_parts) < 2:
            continue  # Skip if not actually duplicate
        
        # Get series from first episode
        episode = media_parts[0]['episode']
        series = episode.show()
        
        # Get TVDB ID from series
        tvdb_id = get_tvdb_id_from_series(series)
        if not tvdb_id:
            log.warning(f"dupe: could not find TVDB ID for series {series.title}, skipping")
            continue
        
        # Find series in Sonarr
        sonarr_series = sonarr_find_series_by_tvdb_id(config, tvdb_id)
        if not sonarr_series:
            log.debug(f"dupe: series {series.title} not found in Sonarr, skipping unmonitor")
        
        # Get season and episode numbers
        season = getattr(episode, "seasonNumber", 0) or getattr(episode, "parentIndex", 0)
        episode_num = getattr(episode, "episodeNumber", 0) or getattr(episode, "index", 0)
        
        # Find episode in Sonarr
        sonarr_episode = None
        if sonarr_series:
            sonarr_episode = sonarr_find_episode_by_series_and_episode(
                config, sonarr_series["id"], season, episode_num
            )
        
        # Unmonitor episode in Sonarr before deletion
        if sonarr_episode:
            unmonitor_sonarr_episode_if_monitored(sonarr_episode, config, log)
        else:
            log.debug(f"dupe: episode S{season:02d}E{episode_num:02d} not found in Sonarr, skipping unmonitor")
        
        # Sort episodes by quality (worst first)
        sorted_parts = sort_episodes_by_quality(media_parts)
        
        # Delete worst quality (first in sorted list)
        # Keep the best quality, delete the rest
        to_delete = sorted_parts[:-1]  # All except the last (best) one
        
        log.info(f"dupe: found {series.title} S{season:02d}E{episode_num:02d} candidates={len(media_parts)}")
        
        for part_info in to_delete:
            try:
                media = part_info['media']
                media.delete()
                deleted_files += 1
                log.info(f"dupe: deleted file={Path(part_info['file']).name} quality={part_info.get('quality', 'unknown')}")
            except Exception as e:
                log.warning(f"dupe: deletion via plex failed err={e}; trying filesystem delete")
                try:
                    Path(part_info['file']).unlink()
                    deleted_files += 1
                    log.info(f"dupe: deleted via filesystem file={part_info['file']}")
                except Exception as fs_e:
                    log.error(f"dupe: filesystem deletion failed err={fs_e}")
    
    return deleted_files


def run_sonarr_duplicate_cleaner(config=None, log_parent=None):
    """
    Run duplicate episode cleaner.
    
    Returns:
        Tuple of (duplicates_found_count, duplicates_deleted_count)
    """
    log = log_parent or logger

    if config is None:
        config = load_config()

    log.info("dupe_scan: start library=%r", config.plex.tv_library_name)

    # Get all TV shows
    tv_shows = get_plex_tv_shows(config)
    log.info(f"dupe_scan: found {len(tv_shows)} TV shows in library")

    # Filter series with duplicate flag
    duplicate_series = get_series_with_duplicate_flag(tv_shows)
    log.info(f"dupe_scan: found {len(duplicate_series)} series with potential duplicates")

    # Find duplicate episodes
    all_duplicates = {}
    for series in duplicate_series:
        series_duplicates = find_duplicate_episodes(series)
        all_duplicates.update(series_duplicates)

    found = len(all_duplicates)
    deleted = 0

    if found:
        log.info(f"dupe_scan: found {found} duplicate episodes across {len(duplicate_series)} series")
        deleted = process_duplicate_episodes(all_duplicates, config, log)
        log.info("dupe_scan: done found=%d deleted=%d", found, deleted)
    else:
        log.info("dupe_scan: done found=0 deleted=0")

    return found, deleted


if __name__ == "__main__":
    # Allow running as standalone script
    found, deleted = run_sonarr_duplicate_cleaner()
    print(f"Found {found} duplicate episodes, deleted {deleted} files")

