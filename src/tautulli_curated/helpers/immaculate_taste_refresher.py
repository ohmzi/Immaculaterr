#!/usr/bin/env python3
"""
Immaculate Taste Collection Refresher

This script runs during off-peak hours (e.g., midnight) to update the Plex collection
without overwhelming the server. It:
1. Reads recommendation_points.json (which contains all items with points > 0)
2. Randomizes the order of rating keys
3. Removes all items from the collection
4. Adds all items back in the randomized order

This should be scheduled to run via cron or systemd timer at a time when the server is idle.

Usage:
    python3 immaculate_taste_refresher.py [--dry-run] [--verbose]

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
# Go up from immaculate_taste_refresher.py -> helpers/ -> tautulli_curated/ -> src/ -> project root
project_root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(project_root / "src"))

from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.plex_collection_manager import (
    apply_collection_state_to_plex,
    _fetch_by_rating_key,
)
from plexapi.server import PlexServer
from plexapi.exceptions import NotFound

logger = setup_logger("immaculate_taste_refresher")


def load_points(path, logger):
    """Load points data from JSON file."""
    logger.debug(f"Attempting to load points from: {path}")
    try:
        with open(str(path), "r", encoding="utf-8") as f:
            data = json.load(f)
        result = data if isinstance(data, dict) else {}
        logger.debug(f"Successfully loaded {len(result)} entries from points file")
        return result
    except FileNotFoundError:
        logger.error(f"Points file not found: {path}")
        return {}
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in points file {path}: {e}")
        return {}
    except Exception as e:
        logger.exception(f"Failed reading points file: {path}")
        return {}


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Immaculate Taste Collection Refresher - Updates Plex collection during off-peak hours",
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
    logger.info("IMMACULATE TASTE COLLECTION REFRESHER START")
    logger.info("=" * 60)
    
    if args.dry_run:
        logger.warning("DRY RUN MODE - No changes will be made to Plex")
    
    try:
        # Load configuration
        logger.info("Step 1: Loading configuration...")
        config = load_config()
        logger.info(f"  ✓ Config loaded from: {config.base_dir / 'config' / 'config.yaml'}")
        logger.info(f"  ✓ Plex URL: {config.plex.url}")
        logger.info(f"  ✓ Library: {config.plex.movie_library_name}")
        logger.info(f"  ✓ Collection: {config.plex.collection_name}")
        
        # Load points from recommendation_points.json
        logger.info("Step 2: Loading points data...")
        points_path = Path(config.files.points_file).resolve()
        logger.info(f"  Points file: {points_path}")
        
        if not points_path.exists():
            logger.error(f"Points file does not exist: {points_path}")
            logger.info("IMMACULATE TASTE COLLECTION REFRESHER END (file not found)")
            return 1
        
        points_data = load_points(points_path, logger)
        
        if not points_data:
            logger.warning("No points data found. Nothing to do.")
            logger.info("IMMACULATE TASTE COLLECTION REFRESHER END (no points file)")
            return 0
        
        # Get all rating keys (these are the items that should be in the collection)
        rating_keys = list(points_data.keys())
        
        if not rating_keys:
            logger.warning("Points file is empty. Nothing to do.")
            logger.info("IMMACULATE TASTE COLLECTION REFRESHER END (empty points)")
            return 0
        
        logger.info(f"  ✓ Loaded {len(rating_keys)} items from points file")
        logger.debug(f"  Rating keys: {rating_keys[:5]}..." if len(rating_keys) > 5 else f"  Rating keys: {rating_keys}")
        
        # Randomize the order
        logger.info("Step 3: Randomizing collection order...")
        random.shuffle(rating_keys)
        logger.info(f"  ✓ Order randomized")
        logger.debug(f"  First 10 rating keys after shuffle: {rating_keys[:10]}")
        
        # Connect to Plex
        logger.info("Step 4: Connecting to Plex...")
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
            logger.error(f"     This usually means:")
            logger.error(f"     - Plex server is not running")
            logger.error(f"     - Incorrect URL or port")
            logger.error(f"     - Firewall blocking connection")
            raise
        except ReadTimeoutError as e:
            logger.error(f"  ✗ Read TIMEOUT: Plex server took too long to respond")
            logger.error(f"     The server may be overloaded or slow")
            raise
        except ConnectTimeoutError as e:
            logger.error(f"  ✗ Connect TIMEOUT: Could not establish connection to Plex")
            logger.error(f"     URL: {config.plex.url}")
            logger.error(f"     Check if Plex server is running and accessible")
            raise
        except Exception as e:
            error_type = type(e).__name__
            logger.error(f"  ✗ Failed to connect to Plex: {error_type}: {e}")
            logger.error(f"     URL: {config.plex.url}")
            if "401" in str(e) or "unauthorized" in str(e).lower():
                logger.error(f"     This looks like an authentication error - check your Plex token")
            elif "404" in str(e) or "not found" in str(e).lower():
                logger.error(f"     Plex server not found at this URL")
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
            logger.error(f"     Library name: {config.plex.movie_library_name}")
            logger.error(f"     Plex server may be slow or overloaded")
            raise
        except NotFound as e:
            logger.error(f"  ✗ Library section not found: {config.plex.movie_library_name}")
            logger.error(f"     Available libraries: {[lib.title for lib in plex.library.sections()]}")
            raise
        except Exception as e:
            error_type = type(e).__name__
            logger.error(f"  ✗ Failed to load library section: {error_type}: {e}")
            logger.error(f"     Library name: {config.plex.movie_library_name}")
            raise
        
        # Fetch items and build collection state
        logger.info("Step 5: Fetching items from Plex...")
        logger.info(f"  Fetching {len(rating_keys)} items...")
        items = []
        failed_keys = []
        filtered_non_movies = []
        for i, rating_key in enumerate(rating_keys, 1):
            if i % 100 == 0 or i == len(rating_keys):
                logger.info(f"  Progress: {i}/{len(rating_keys)} items checked ({len(items)} movies found, {len(failed_keys)} not found, {len(filtered_non_movies)} non-movies filtered)")
            
            item = _fetch_by_rating_key(section, rating_key)
            if item:
                # Only include movie items (filter out clips, shows, etc.)
                item_type = getattr(item, 'type', '').lower()
                if item_type == 'movie':
                    items.append({
                        "rating_key": str(item.ratingKey),
                        "title": item.title,
                        "year": getattr(item, "year", None),
                    })
                else:
                    filtered_non_movies.append({
                        "rating_key": str(item.ratingKey),
                        "title": item.title,
                        "type": item_type,
                    })
                    logger.debug(f"  Filtered out non-movie: {item.title} (type: {item_type})")
            else:
                failed_keys.append(rating_key)
                # Only log individual failures at debug level to reduce noise
                logger.debug(f"  Could not find item with rating_key={rating_key}")
        
        if filtered_non_movies:
            logger.info(f"  ⚠ Filtered out {len(filtered_non_movies)} non-movie items (clips, shows, etc.)")
            # Log a sample at debug level
            if len(filtered_non_movies) > 0:
                sample = filtered_non_movies[:5]
                for filtered in sample:
                    logger.debug(f"    - {filtered['title']} (type: {filtered['type']})")
                if len(filtered_non_movies) > 5:
                    logger.debug(f"    ... and {len(filtered_non_movies) - 5} more")
        
        if failed_keys:
            logger.info(f"  ⚠ {len(failed_keys)} items not found in Plex (they may have been removed)")
            # Log a sample of failed keys at debug level if verbose
            if len(failed_keys) > 0:
                logger.debug(f"  Sample of failed rating keys (first 10): {failed_keys[:10]}")
        
        if not items:
            logger.warning("No valid items found in Plex. Nothing to do.")
            logger.info("IMMACULATE TASTE COLLECTION REFRESHER END (no valid items)")
            return 0
        
        logger.info(f"  ✓ Found {len(items)} valid items in Plex")
        if failed_keys:
            logger.info(f"  ⚠ {len(failed_keys)} items from points file not found in Plex (will be skipped)")
        
        # Log sample titles
        logger.info("Step 6: Collection preview...")
        sample_titles = [f"{item['title']} ({item['year']})" if item['year'] else item['title'] 
                        for item in items[:10]]
        logger.info(f"  First 10 items in randomized order:")
        for idx, title in enumerate(sample_titles, 1):
            logger.info(f"    {idx:2d}. {title}")
        
        # Build collection state dict
        collection_state = {
            "rating_keys": [item["rating_key"] for item in items],
            "items": items,
        }
        
        # Apply the collection state to Plex
        if args.dry_run:
            logger.info("Step 7: DRY RUN - Would apply collection state to Plex...")
            logger.info(f"  Would remove all existing items from collection")
            logger.info(f"  Would add {len(items)} items in randomized order")
            logger.info("  (No actual changes made)")
        else:
            logger.info("Step 7: Applying collection state to Plex...")
            logger.info(f"  This may take a while for large collections...")
            stats = apply_collection_state_to_plex(
                plex=plex,
                library_name=config.plex.movie_library_name,
                collection_name=config.plex.collection_name,
                collection_state=collection_state,
                logger=logger,
                base_dir=config.base_dir,
            )
            logger.info(f"  ✓ Collection update complete")
            logger.debug(f"  Stats: {stats}")
        
        # Final summary
        logger.info("=" * 60)
        logger.info("IMMACULATE TASTE COLLECTION REFRESHER SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Items in points file: {len(rating_keys)}")
        logger.info(f"Movies found in Plex: {len(items)}")
        logger.info(f"Items not found: {len(failed_keys)}")
        if 'filtered_non_movies' in locals() and filtered_non_movies:
            logger.info(f"Non-movie items filtered: {len(filtered_non_movies)}")
        if not args.dry_run:
            logger.info(f"Collection updated: ✓")
        else:
            logger.info(f"Collection updated: (DRY RUN - no changes)")
        logger.info("=" * 60)
        logger.info("IMMACULATE TASTE COLLECTION REFRESHER END OK")
        logger.info("=" * 60)
        return 0
        
    except KeyboardInterrupt:
        logger.warning("\nInterrupted by user")
        logger.info("IMMACULATE TASTE COLLECTION REFRESHER END (interrupted)")
        return 130
    except Exception as e:
        logger.exception("IMMACULATE TASTE COLLECTION REFRESHER END FAIL")
        logger.error(f"Error: {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

