
#!/usr/bin/env python3
"""
Recently Watched Collections Refresher

This script runs during off-peak hours (e.g., midnight) to refresh Plex collections
by randomizing their order. It:
1. Reads collection JSON files (recently_watched_collection.json and change_of_taste_collection.json)
2. Randomizes the order of movies in each collection
3. Removes all items from each Plex collection
4. Adds all items back in the randomized order

This should be scheduled to run via cron or systemd timer at a time when the server is idle.

Usage:
    python3 recently_watched_collections_refresher.py [--dry-run] [--verbose]

Options:
    --dry-run    Show what would be done without actually updating Plex
    --verbose    Enable debug-level logging
"""

import sys
import json
import random
import argparse
import logging
import time
from pathlib import Path
from requests.exceptions import Timeout, ConnectionError as RequestsConnectionError
from urllib3.exceptions import ReadTimeoutError, ConnectTimeoutError

# Add project root to path for standalone execution
# Go up from recently_watched_collections_refresher.py -> helpers/ -> tautulli_curated/ -> src/ -> project root
project_root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(project_root / "src"))

from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.retry_utils import retry_with_backoff, safe_execute
from tautulli_curated.helpers.plex_collection_manager import (
    _set_collection_artwork,
    _fetch_by_rating_key,
    _apply_custom_order,
    _pin_curated_collection_hubs,
)
from plexapi.server import PlexServer
from plexapi.exceptions import NotFound, BadRequest

logger = setup_logger("recently_watched_collections_refresher")

# Collection configurations
COLLECTIONS = [
    {
        "name": "Based on your recently watched movie",
        "json_file": "recently_watched_collection.json",
    },
    {
        "name": "Change of Taste",
        "json_file": "change_of_taste_collection.json",
    },
]


def load_collection_json(json_file, config, logger):
    """Load collection data from JSON file."""
    # Use config's base_dir to find data directory
    json_path = config.base_dir / "data" / json_file
    
    logger.debug(f"Attempting to load collection from: {json_path}")
    try:
        if not json_path.exists():
            logger.warning(f"Collection JSON file not found: {json_path}")
            return None
        
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        # Handle both list of dicts and list of strings
        if isinstance(data, list):
            if len(data) > 0 and isinstance(data[0], str):
                # Convert list of strings to list of dicts
                data = [{"title": title} for title in data]
            result = data
        else:
            logger.warning(f"Unexpected JSON format in {json_file}")
            return None
        
        logger.debug(f"Successfully loaded {len(result)} entries from {json_file}")
        return result
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {json_file}: {e}")
        return None
    except Exception as e:
        logger.exception(f"Failed reading {json_file}: {e}")
        return None


def find_movie_by_title(section, title, logger):
    """Find a movie by title (fallback if rating key not available)."""
    try:
        for movie in section.search(title):
            if movie.title.lower() == title.lower():
                return movie
    except Exception as e:
        logger.debug(f"Search failed for title={title}: {e}")
    return None


def apply_collection_to_plex(
    plex,
    section,
    collection_name: str,
    movies: list,
    logger,
    dry_run: bool = False,
    base_dir: Path = None,
):
    """
    Apply collection movies to Plex by:
    1. Removing all existing items from the collection
    2. Adding all movies in the provided order
    
    Args:
        plex: PlexServer instance
        section: Library section
        collection_name: Name of the collection
        movies: List of movie dicts with 'title' and optionally 'rating_key'
        logger: Logger instance
        dry_run: If True, don't actually update Plex
    """
    if not movies:
        logger.warning(f"  No movies to add to collection '{collection_name}'")
        return {"added": 0, "failed": 0, "filtered": 0}
    
    # Get or find collection
    collection = None
    existing_items = []
    try:
        collection = section.collection(collection_name)
        existing_items = collection.items()
        logger.info(f"  Found existing collection with {len(existing_items)} items")
    except NotFound:
        existing_items = []
        logger.info(f"  Collection '{collection_name}' not found, will create it")
    except Exception as e:
        logger.warning(f"  Could not check for existing collection: {e}")
        existing_items = []
    
    # Fetch movies from Plex and filter to only movies
    # Prioritize rating keys (faster) over title searches
    valid_movies = []
    failed_movies = []
    filtered_non_movies = []
    
    logger.info(f"  Fetching {len(movies)} movies from Plex...")
    logger.info(f"  Using rating keys for faster lookups (similar to Immaculate Taste refresher)...")
    
    for i, movie_data in enumerate(movies, 1):
        if i % 100 == 0 or i == len(movies):
            logger.info(f"  Progress: {i}/{len(movies)} items checked ({len(valid_movies)} movies found, {len(failed_movies)} not found, {len(filtered_non_movies)} non-movies filtered)")
        
        movie = None
        title = movie_data.get("title", "Unknown")
        rating_key = movie_data.get("rating_key")
        
        # Try rating key first (faster, same as immaculate_taste_refresher)
        if rating_key:
            movie = _fetch_by_rating_key(section, rating_key)
            if movie:
                # Verify it's the right item by checking title (safety check)
                if hasattr(movie, 'title') and movie.title.lower() != title.lower():
                    logger.debug(f"    Rating key {rating_key} points to different title: '{movie.title}' vs '{title}', will try title search")
                    movie = None
        
        # Fallback to title search if rating key lookup failed
        if not movie:
            movie = find_movie_by_title(section, title, logger)
        
        if movie:
            # Filter to only movies (same logic as immaculate_taste_refresher)
            item_type = getattr(movie, 'type', '').lower()
            if item_type == 'movie':
                valid_movies.append(movie)
            else:
                filtered_non_movies.append({
                    'title': title,
                    'type': item_type,
                    'rating_key': rating_key,
                })
                logger.debug(f"    Filtered out non-movie: {title} (type: {item_type}, rating_key: {rating_key})")
        else:
            failed_movies.append({
                'title': title,
                'rating_key': rating_key,
            })
            # Only log individual failures at debug level to reduce noise
            # These are movies that aren't in Plex yet - they'll be added when downloaded
            logger.debug(f"    Movie not in Plex yet: {title} (will be added when downloaded)")
    
    if filtered_non_movies:
        logger.info(f"  ⚠ Filtered out {len(filtered_non_movies)} non-movie items (clips, shows, etc.)")
        # Log a sample at debug level
        if len(filtered_non_movies) > 0:
            sample = filtered_non_movies[:5]
            for filtered in sample:
                logger.debug(f"    - {filtered['title']} (type: {filtered['type']}, rating_key: {filtered.get('rating_key', 'N/A')})")
            if len(filtered_non_movies) > 5:
                logger.debug(f"    ... and {len(filtered_non_movies) - 5} more")
    
    if failed_movies:
        logger.info(f"  ⚠ {len(failed_movies)} movies not found in Plex yet (will be skipped - they'll be added when downloaded)")
        # Log a sample of missing movies at debug level if verbose
        if len(failed_movies) > 0:
            sample = failed_movies[:5]
            failed_sample = [f"{f.get('title', 'Unknown')}" for f in sample]
            logger.debug(f"  Sample of movies not yet in Plex (first 5): {failed_sample}")
            if len(failed_movies) > 5:
                logger.debug(f"    ... and {len(failed_movies) - 5} more")
    
    if not valid_movies:
        logger.warning(f"  No valid movies found in Plex for collection '{collection_name}'")
        return {"added": 0, "failed": len(failed_movies), "filtered": len(filtered_non_movies)}
    
    logger.info(f"  ✓ Found {len(valid_movies)} valid movies in Plex")
    
    if dry_run:
        logger.info(f"  DRY RUN - Would update collection '{collection_name}'")
        logger.info(f"    Would remove {len(existing_items)} existing items")
        logger.info(f"    Would add {len(valid_movies)} movies in randomized order")
        return {"added": len(valid_movies), "failed": len(failed_movies), "filtered": len(filtered_non_movies)}
    
    # Remove all existing items
    if existing_items and collection:
        logger.info(f"  Removing all {len(existing_items)} existing items...")
        logger.info("    This may take a while for large collections. Please wait...")
        try:
            start_time = time.time()
            def _remove_items():
                collection.removeItems(existing_items)
                return True
            
            _, success = retry_with_backoff(
                _remove_items,
                max_retries=3,
                logger_instance=logger,
                operation_name=f"Remove {len(existing_items)} items from '{collection_name}'",
                raise_on_final_failure=False,
            )
            
            if not success:
                logger.warning(f"  ⚠ Failed to remove some items, continuing anyway...")
            elapsed = time.time() - start_time
            logger.info(f"  Remove completed in {elapsed:.1f} seconds")
        except BadRequest as e:
            logger.error(f"  ERROR removing items (BadRequest): {e}")
            # Try alternative method - remove items one by one
            logger.info("  Attempting alternative removal method...")
            try:
                start_time = time.time()
                for item in existing_items:
                    try:
                        if hasattr(item, "removeCollection"):
                            item.removeCollection(collection_name)
                        elif hasattr(item, "editTags"):
                            current = [c.tag for c in getattr(item, "collections", [])] or []
                            new_list = [c for c in current if c.lower() != collection_name.lower()]
                            item.editTags("collection", new_list, locked=False)
                    except Exception as e2:
                        logger.debug(f"    Failed to remove {getattr(item, 'title', 'Unknown')}: {e2}")
                elapsed = time.time() - start_time
                logger.info(f"  Alternative remove completed in {elapsed:.1f} seconds")
            except Exception as e2:
                logger.error(f"  ERROR in alternative removal: {type(e2).__name__}: {e2}")
                # Continue anyway - try to add new items
        except Exception as e:
            logger.error(f"  ERROR removing items: {type(e).__name__}: {e}")
            # Continue anyway - try to add new items
    
    # Add all movies in randomized order
    if not valid_movies:
        logger.warning(f"  No valid movies to add")
        return {"added": 0, "failed": len(failed_movies), "filtered": len(filtered_non_movies)}
    
    logger.info(f"  Adding {len(valid_movies)} movies...")
    logger.info("    This may take a while for large collections. Please wait...")
    
    added_count = 0
    failed_count = 0
    
    try:
        start_time = time.time()
        
        # Create collection if it doesn't exist
        if not collection:
            logger.info(f"  Creating collection with {len(valid_movies)} items...")
            try:
                section.createCollection(collection_name, items=valid_movies)
                collection = section.collection(collection_name)
                added_count = len(valid_movies)
                elapsed = time.time() - start_time
                logger.info(f"  Collection created in {elapsed:.1f} seconds")
            except BadRequest as e:
                # If creation fails due to mixed media types, filter and retry
                if "mix media types" in str(e).lower():
                    logger.warning(f"  Collection creation failed due to mixed media types, filtering...")
                    # This shouldn't happen since we already filtered, but handle it
                    movie_only = [m for m in valid_movies if getattr(m, 'type', '').lower() == 'movie']
                    if movie_only:
                        section.createCollection(collection_name, items=movie_only)
                        collection = section.collection(collection_name)
                        added_count = len(movie_only)
                        elapsed = time.time() - start_time
                        logger.info(f"  Collection created with {len(movie_only)} movies in {elapsed:.1f} seconds")
                    else:
                        logger.error(f"  No valid movies after filtering")
                        raise
                else:
                    raise
        else:
            # Add items to existing collection
            try:
                def _add_items():
                    collection.addItems(valid_movies)
                    return True
                
                _, success = retry_with_backoff(
                    _add_items,
                    max_retries=3,
                    logger_instance=logger,
                    operation_name=f"Add {len(valid_movies)} items to '{collection_name}'",
                    raise_on_final_failure=False,
                )
                
                if not success:
                    logger.warning(f"  ⚠ Failed to add some items, continuing anyway...")
                    failed_count += len(valid_movies)
                else:
                    added_count = len(valid_movies)
                added_count = len(valid_movies)
                elapsed = time.time() - start_time
                logger.info(f"  Add completed in {elapsed:.1f} seconds")
            except BadRequest as e:
                # If add fails due to mixed media types, filter and retry
                if "mix media types" in str(e).lower():
                    logger.warning(f"  Add failed due to mixed media types, filtering...")
                    movie_only = [m for m in valid_movies if getattr(m, 'type', '').lower() == 'movie']
                    if movie_only:
                        def _add_filtered():
                            collection.addItems(movie_only)
                            return True
                        
                        _, success = retry_with_backoff(
                            _add_filtered,
                            max_retries=3,
                            logger_instance=logger,
                            operation_name=f"Add {len(movie_only)} filtered items to '{collection_name}'",
                            raise_on_final_failure=False,
                        )
                        
                        if not success:
                            logger.warning(f"  ⚠ Failed to add filtered items, continuing anyway...")
                            failed_count += len(movie_only)
                        else:
                            added_count = len(movie_only)
                        added_count = len(movie_only)
                        elapsed = time.time() - start_time
                        logger.info(f"  Add completed with {len(movie_only)} movies in {elapsed:.1f} seconds")
                    else:
                        logger.error(f"  No valid movies after filtering")
                        failed_count = len(valid_movies)
                else:
                    raise
    except Exception as e:
        logger.error(f"  ERROR adding items: {type(e).__name__}: {e}")
        failed_count = len(valid_movies) - added_count
    
    # Apply custom order (randomized order from JSON) - only if items were successfully added
    order_stats = {}
    if collection and valid_movies and added_count > 0 and not dry_run:
        try:
            logger.info(f"  Applying custom order to {len(valid_movies)} items...")
            logger.info("    Reordering items. This may take several minutes for large collections...")
            logger.info("    Note: Some items may fail to reorder, but the script will continue...")
            start_time = time.time()
            order_stats = _apply_custom_order(plex, collection, valid_movies, logger=logger) or {}
            elapsed = time.time() - start_time
            logger.info(f"  Custom order completed in {elapsed:.1f} seconds")
        except (BadRequest, Exception) as e:
            error_type = type(e).__name__
            error_msg = str(e)
            logger.warning(f"  ⚠ Some errors occurred during custom ordering: {error_type}")
            logger.warning(f"    The collection has been updated, but ordering may be incomplete")
            logger.warning(f"    This is usually not critical - items are still in the collection")
            if isinstance(e, BadRequest) or "bad_request" in error_msg.lower() or "400" in error_msg:
                logger.warning(f"    Plex rejected some reorder requests (this is common with large collections)")
            logger.debug(f"    Full error: {error_msg[:200]}")
            # Don't raise - collection is still updated, just ordering may be incomplete
    
    # Set collection artwork if available (only if collection exists and items were added)
    if collection and (added_count > 0 or existing_items):
        try:
            logger.info(f"  Setting collection artwork...")
            _set_collection_artwork(collection, collection_name, base_dir, logger)
        except Exception as e:
            logger.warning(f"  ⚠ Failed to set artwork (non-critical): {e}")

    # Ensure curated collections are visible + pinned at top (Manage Recommendations)
    if collection and (added_count > 0 or existing_items) and not dry_run:
        try:
            pin_stats = _pin_curated_collection_hubs(plex, section, logger=logger)
            logger.info(f"  hub_pin: done stats={pin_stats}")
        except Exception as e:
            logger.warning(f"  hub_pin: failed (non-critical): {type(e).__name__}: {e}")
    
    return {
        "added": added_count,
        "failed": failed_count + len(failed_movies),
        "filtered": len(filtered_non_movies),
        "order_stats": order_stats,
    }


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Recently Watched Collections Refresher - Refreshes Plex collections during off-peak hours",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without actually updating Plex",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable debug-level logging",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    
    # Set logging level
    if args.verbose:
        logger.setLevel(logging.DEBUG)
        logger.debug("Verbose logging enabled")
    
    logger.info("=" * 60)
    logger.info("RECENTLY WATCHED COLLECTIONS REFRESHER START")
    logger.info("=" * 60)
    
    if args.dry_run:
        logger.warning("DRY RUN MODE - No changes will be made to Plex")
    
    try:
        # Load configuration
        logger.info("Step 1: Loading configuration...")
        config = load_config()
        logger.info(f"  ✓ Config loaded from: {config.config_path}")
        logger.info(f"  ✓ Plex URL: {config.plex.url}")
        logger.info(f"  ✓ Library: {config.plex.movie_library_name}")
        
        # Connect to Plex
        logger.info("Step 2: Connecting to Plex...")
        logger.info(f"  Connecting to: {config.plex.url}")
        logger.info("  Please wait, this may take a few seconds...")
        
        plex = None
        try:
            start_time = time.time()
            # Set timeout to 30 seconds for connection
            plex = PlexServer(config.plex.url, config.plex.token, timeout=30)
            elapsed = time.time() - start_time
            logger.info(f"  ✓ Connected to Plex server: {plex.friendlyName} (took {elapsed:.1f}s)")
        except Timeout as e:
            logger.error(f"  ✗ Connection TIMEOUT: Plex server did not respond within 30 seconds")
            logger.error(f"     URL: {config.plex.url}")
            logger.error(f"     This usually means:")
            logger.error(f"     - Plex server is down or not responding")
            logger.error(f"     - Network connectivity issues")
            logger.error(f"     - Plex server is overloaded")
            raise
        except RequestsConnectionError as e:
            logger.error(f"  ✗ Connection ERROR: Could not reach Plex server")
            logger.error(f"     URL: {config.plex.url}")
            logger.error(f"     Error: {e}")
            raise
        except ReadTimeoutError as e:
            logger.error(f"  ✗ Read TIMEOUT: Plex server took too long to respond")
            raise
        except ConnectTimeoutError as e:
            logger.error(f"  ✗ Connect TIMEOUT: Could not establish connection to Plex")
            raise
        except Exception as e:
            error_type = type(e).__name__
            logger.error(f"  ✗ Failed to connect to Plex: {error_type}: {e}")
            if "401" in str(e) or "unauthorized" in str(e).lower():
                logger.error(f"     This looks like an authentication error - check your Plex token")
            raise
        
        # Load library section
        try:
            logger.info(f"  Loading library section: {config.plex.movie_library_name}...")
            start_time = time.time()
            section = plex.library.section(config.plex.movie_library_name)
            elapsed = time.time() - start_time
            logger.info(f"  ✓ Library section loaded: {section.title} (took {elapsed:.1f}s)")
        except Timeout as e:
            logger.error(f"  ✗ TIMEOUT loading library section")
            raise
        except NotFound as e:
            logger.error(f"  ✗ Library section not found: {config.plex.movie_library_name}")
            raise
        except Exception as e:
            error_type = type(e).__name__
            logger.error(f"  ✗ Failed to load library section: {error_type}: {e}")
            raise
        
        # Process each collection
        total_stats = {
            "collections_processed": 0,
            "total_added": 0,
            "total_failed": 0,
            "total_filtered": 0,
            "total_reorder_failed": 0,
        }
        
        for collection_config in COLLECTIONS:
            collection_name = collection_config["name"]
            json_file = collection_config["json_file"]
            
            logger.info("=" * 60)
            logger.info(f"Processing collection: {collection_name}")
            logger.info("=" * 60)
            
            # Load collection JSON
            logger.info(f"Step 3: Loading collection data from {json_file}...")
            movies = load_collection_json(json_file, config, logger)
            
            if not movies:
                logger.warning(f"  ⚠ Collection JSON is empty or not found - skipping '{collection_name}'")
                continue
            
            if not isinstance(movies, list) or len(movies) == 0:
                logger.warning(f"  ⚠ Collection JSON has no movies - skipping '{collection_name}'")
                continue
            
            logger.info(f"  ✓ Loaded {len(movies)} movies from {json_file}")
            
            # Randomize order
            logger.info("Step 4: Randomizing collection order...")
            random.shuffle(movies)
            logger.info(f"  ✓ Order randomized")
            
            # Log sample
            sample_titles = [m.get("title", "Unknown") for m in movies[:10]]
            logger.info(f"  First 10 movies in randomized order:")
            for idx, title in enumerate(sample_titles, 1):
                logger.info(f"    {idx:2d}. {title}")
            
            # Apply to Plex
            logger.info(f"Step 5: Applying collection to Plex...")
            stats = apply_collection_to_plex(
                plex=plex,
                section=section,
                collection_name=collection_name,
                movies=movies,
                logger=logger,
                dry_run=args.dry_run,
                base_dir=config.base_dir,
            )
            
            total_stats["collections_processed"] += 1
            total_stats["total_added"] += stats["added"]
            total_stats["total_failed"] += stats["failed"]
            total_stats["total_filtered"] += stats["filtered"]
            total_stats["total_reorder_failed"] += int((stats.get("order_stats") or {}).get("failed", 0) or 0)
            
            logger.info(f"  ✓ Collection update complete: {stats}")
        
        # Final summary
        logger.info("=" * 60)
        logger.info("RECENTLY WATCHED COLLECTIONS REFRESHER SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Collections processed: {total_stats['collections_processed']}")
        logger.info(f"Total movies added: {total_stats['total_added']}")
        logger.info(f"Total movies failed: {total_stats['total_failed']}")
        logger.info(f"Total non-movies filtered: {total_stats['total_filtered']}")
        logger.info(f"Total reorder failures: {total_stats['total_reorder_failed']}")
        if not args.dry_run:
            logger.info(f"Collections updated: ✓")
        else:
            logger.info(f"Collections updated: (DRY RUN - no changes)")
        logger.info("=" * 60)

        # Determine final status + exit code for monitoring/alerting
        status = "SUCCESS"
        exit_code = 0
        if not args.dry_run:
            if total_stats["total_failed"] > 0 or total_stats["total_reorder_failed"] > 0:
                status = "PARTIAL"
                exit_code = 10

        logger.info(f"RECENTLY WATCHED COLLECTIONS REFRESHER END {status}")
        logger.info(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
        logger.info("=" * 60)
        return exit_code
        
    except KeyboardInterrupt:
        logger.warning("\nInterrupted by user")
        logger.info("RECENTLY WATCHED COLLECTIONS REFRESHER END (interrupted)")
        logger.info("FINAL_STATUS=INTERRUPTED FINAL_EXIT_CODE=130")
        return 130
    except Exception as e:
        # Categorize dependency failures vs internal failures for monitoring
        dependency_failed = isinstance(e, (Timeout, RequestsConnectionError, ReadTimeoutError, ConnectTimeoutError))
        status = "DEPENDENCY_FAILED" if dependency_failed else "FAILED"
        exit_code = 20 if dependency_failed else 30

        logger.exception("RECENTLY WATCHED COLLECTIONS REFRESHER END FAIL")
        logger.error(f"Error: {type(e).__name__}: {e}")
        logger.error(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
        return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

