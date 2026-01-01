import sys
import json
import time
from pathlib import Path
from tautulli_curated.helpers.radarr_utils import radarr_add_or_monitor_missing
from tautulli_curated.helpers.plex_search import find_plex_movie
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.change_of_taste_collection import run_change_of_taste_collection
from tautulli_curated.helpers.recommender import get_recommendations
from tautulli_curated.helpers.tmdb_cache import TMDbCache
from plexapi.server import PlexServer

logger = setup_logger("recently_watched_collection")

RADARR_TAGS = ["movies", "due-to-previously-watched"]
COLLECTION_NAME = "Based on your recently watched movie"
JSON_FILE = "recently_watched_collection.json"


def save_collection_to_json(movies, json_file, config):
    """
    Save collection movies to JSON file.
    Movies should be a list of dicts with 'title' and optionally 'rating_key'.
    """
    # Use config's base_dir to find data directory
    json_path = config.base_dir / "data" / json_file
    
    try:
        with open(str(json_path), "w", encoding="utf-8") as f:
            json.dump(movies, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved {len(movies)} movies to {json_file}")
    except Exception as e:
        logger.exception(f"Failed to save collection to {json_file}: {e}")
        raise


def run_recently_watched_playlist(movie_name, config):
    """
    Process recently watched movie and generate recommendations.
    Returns dict with stats: {"found_in_plex", "missing_in_plex", "saved_to_json", "sent_to_radarr"}
    """
    logger.info(f"Processing movie: {movie_name}")
    
    try:
        # Connect to Plex with timeout and retry logic
        from tautulli_curated.helpers.retry_utils import retry_with_backoff
        
        def _connect_plex():
            return PlexServer(config.plex.url, config.plex.token, timeout=30)
        
        plex, success = retry_with_backoff(
            _connect_plex,
            max_retries=3,
            logger_instance=logger,
            operation_name="Plex connection",
            raise_on_final_failure=True,  # Can't continue without Plex
        )
        
        if not success:
            raise ConnectionError("Failed to connect to Plex after retries")
        
        # Get recommendations (Google→OpenAI if configured, else TMDb fallback)
        logger.info("Step 1: Getting recommendations (Google/OpenAI optional, TMDb fallback)...")
        # Build TMDb cache (required for TMDb advanced fallback)
        # TMDb cache file is hardcoded as tmdb_cache.json
        try:
            tmdb_cache_path = config.base_dir / "data" / "tmdb_cache.json"
            tmdb_cache = TMDbCache(config.tmdb.api_key, str(tmdb_cache_path))
        except Exception:
            tmdb_cache = None
        recommendations = get_recommendations(movie_name, plex=plex, tmdb_cache=tmdb_cache, media_type="movie")[:15]
        logger.info(f"  ✓ Returned {len(recommendations)} recommendations")
        
        collection_movies = []
        missing_in_plex = []
        missing_seen = set()

        # Plex-first pass (single loop)
        logger.info("Step 2: Checking movies in Plex...")
        for title in recommendations:
            try:
                plex_movie = find_plex_movie(plex, title, library_name=config.plex.movie_library_name, logger=logger)
                if plex_movie:
                    # Store with rating key for faster lookup later
                    collection_movies.append({
                        "title": plex_movie.title,
                        "rating_key": str(plex_movie.ratingKey),
                        "year": getattr(plex_movie, "year", None),
                    })
                else:
                    logger.debug(f"  Missing in Plex: {title}")
                    # Still add to collection_movies (without rating_key) so it can be added later if downloaded
                    collection_movies.append({
                        "title": title.strip(),
                        "rating_key": None,
                        "year": None,
                    })
                    key = title.strip().lower()
                    if key and key not in missing_seen:
                        missing_seen.add(key)
                        missing_in_plex.append(title.strip())
            except Exception as e:
                logger.warning(f"  Error checking '{title}' in Plex: {e}")
                # Still add to collection_movies (without rating_key) so it can be added later if downloaded
                collection_movies.append({
                    "title": title.strip(),
                    "rating_key": None,
                    "year": None,
                })
                # Continue processing other movies
                key = title.strip().lower()
                if key and key not in missing_seen:
                    missing_seen.add(key)
                    missing_in_plex.append(title.strip())

        logger.info(f"  ✓ Found {len(collection_movies) - len(missing_in_plex)} movies in Plex")
        logger.info(f"  ✓ {len(missing_in_plex)} movies missing in Plex (will be added to JSON for future refresh)")

        # Save to JSON (ALL recommendations - found and missing)
        # The refresher will skip missing movies and add them when they become available
        saved_to_json = False
        if collection_movies:
            try:
                save_collection_to_json(collection_movies, JSON_FILE, config)
                logger.info(f"Step 3: Saved {len(collection_movies)} movies to {JSON_FILE} (including {len(missing_in_plex)} not yet in Plex)")
                logger.info(f"  ✓ Collection state saved (will be applied by refresher - missing movies will be skipped until downloaded)")
                saved_to_json = True
            except Exception as e:
                logger.error(f"  ✗ Failed to save collection to JSON: {e}")
                raise
        else:
            logger.warning(f"Step 3: No recommendations to save to collection")

        # Radarr processing for missing titles
        sent_to_radarr = 0
        if missing_in_plex:
            logger.info(f"Step 4: Processing {len(missing_in_plex)} missing movies in Radarr...")
            try:
                radarr_result = radarr_add_or_monitor_missing(config, missing_in_plex) or {}
                # radarr_add_or_monitor_missing now returns {"added": count, "monitored": count, "failed": count}
                sent_to_radarr = radarr_result.get("added", 0) + radarr_result.get("monitored", 0)
                if radarr_result.get("failed", 0) > 0:
                    logger.warning(f"  ⚠ {radarr_result.get('failed', 0)} movies failed to add to Radarr (connection/timeout issues)")
                logger.info(f"  ✓ Processed {len(missing_in_plex)} movies in Radarr")
            except Exception as e:
                logger.error(f"  ✗ Error processing movies in Radarr: {e}")
                # Don't raise - continue execution
                logger.warning(f"  Some movies may not have been added to Radarr")
        else:
            logger.info(f"Step 4: No missing movies to process in Radarr")
        
        return {
            "found_in_plex": len(collection_movies),
            "missing_in_plex": len(missing_in_plex),
            "saved_to_json": saved_to_json,
            "sent_to_radarr": sent_to_radarr,
        }
    except Exception as e:
        logger.exception(f"Error in run_recently_watched_playlist: {e}")
        raise


def main():
    """
    Main entry point for the Recently Watched Collection script.
    Can be called from the backward-compatible wrapper or run directly.
    """
    script_start_time = time.time()
    exit_code = 0
    
    try:
        logger.info("=" * 60)
        logger.info("RECENTLY WATCHED COLLECTION SCRIPT START")
        logger.info("=" * 60)
        
        # Parse arguments
        if len(sys.argv) < 2:
            logger.error("Usage: python3 tautulli_recently_watched_collection.py \"Movie Name\" [media_type]")
            logger.error("RECENTLY WATCHED COLLECTION SCRIPT END FAIL")
            return 1

        movie_name = sys.argv[1]
        media_type = sys.argv[2] if len(sys.argv) > 2 else "movie"
        
        logger.info(f"Movie: {movie_name}")
        logger.info(f"Media type: {media_type}")
        logger.info("")
        
        # Load configuration to check if collection refresher should run
        logger.info("Loading configuration...")
        config = load_config()
        logger.info(f"  ✓ Configuration loaded")
        logger.info("")
        
        # Check collection refresher setting
        run_refresher = config.scripts_run.run_recently_watched_refresher
        logger.info("Collection Refresher Configuration:")
        if run_refresher:
            logger.info(f"  ✓ Collection Refresher: ENABLED")
            logger.info(f"    → Recently Watched Collection Refresher will run at the end of this script")
            logger.info(f"    → This will randomize and update both Plex collections")
            logger.info(f"    → Note: This may take a while for large collections")
        else:
            logger.info(f"  ⚠ Collection Refresher: DISABLED")
            logger.info(f"    → Recently Watched Collection Refresher will NOT run as part of this script")
            logger.info(f"    → To run it independently, use: ./src/scripts/run_recently_watched_collections_refresher.sh")
            logger.info(f"    → Or set 'run_collection_refresher: true' in config/config.yaml")
        logger.info("")
        
        # Process recently watched collection
        logger.info("Processing 'Based on your recently watched movie' collection...")
        logger.info("-" * 60)
        stats_recent = None
        try:
            stats_recent = run_recently_watched_playlist(movie_name, config)
            logger.info("-" * 60)
            logger.info(f"✓ Recently watched collection processed successfully")
        except Exception as e:
            logger.error(f"✗ Error processing recently watched collection: {e}")
            logger.exception("Full traceback:")
            exit_code = 1
        
        logger.info("")
        
        # Process change of taste collection
        logger.info("Processing 'Change of Taste' collection...")
        logger.info("-" * 60)
        stats_change = None
        try:
            stats_change = run_change_of_taste_collection(movie_name, config, max_results=15)
            logger.info("-" * 60)
            logger.info(f"✓ Change of taste collection processed successfully")
        except Exception as e:
            logger.error(f"✗ Error processing change of taste collection: {e}")
            logger.exception("Full traceback:")
            exit_code = 1
        
        # Final summary
        elapsed_time = time.time() - script_start_time
        logger.info("")
        logger.info("=" * 60)
        logger.info("RECENTLY WATCHED COLLECTION SCRIPT SUMMARY")
        logger.info("=" * 60)
        if stats_recent:
            logger.info(f"Recently Watched Collection:")
            logger.info(f"  - Found in Plex: {stats_recent.get('found_in_plex', 0)}")
            logger.info(f"  - Missing in Plex: {stats_recent.get('missing_in_plex', 0)}")
            logger.info(f"  - Saved to JSON: {'✓' if stats_recent.get('saved_to_json') else '✗'}")
            logger.info(f"  - Sent to Radarr: {stats_recent.get('sent_to_radarr', 0)}")
        if stats_change:
            logger.info(f"Change of Taste Collection:")
            logger.info(f"  - Found in Plex: {stats_change.get('found_in_plex', 0)}")
            logger.info(f"  - Missing in Plex: {stats_change.get('missing_in_plex', 0)}")
            logger.info(f"  - Saved to JSON: {'✓' if stats_change.get('saved_to_json') else '✗'}")
            logger.info(f"  - Sent to Radarr: {stats_change.get('sent_to_radarr', 0)}")
        logger.info(f"Total execution time: {elapsed_time:.1f} seconds")
        logger.info("=" * 60)
        
        # Optionally run collection refresher
        if run_refresher:
            logger.info("")
            logger.info("=" * 60)
            logger.info("RUNNING COLLECTION REFRESHER")
            logger.info("=" * 60)
            logger.info("Starting Recently Watched Collection Refresher...")
            logger.info("  This will:")
            logger.info("    1. Read recently_watched_collection.json and change_of_taste_collection.json")
            logger.info("    2. Randomize the order of movies in each collection")
            logger.info("    3. Remove all items from each Plex collection")
            logger.info("    4. Add all items back in randomized order")
            logger.info("  Note: This process may take a while for large collections")
            logger.info("")
            
            try:
                # Import and run the refresher
                # We need to temporarily modify sys.argv to avoid argument conflicts
                from tautulli_curated.helpers import recently_watched_collections_refresher as refresher_module
                
                # Save original argv
                original_argv = sys.argv
                try:
                    # Set up minimal argv for the refresher's argument parser
                    # This ensures parse_args() doesn't try to parse the main script's arguments
                    sys.argv = ['recently_watched_collections_refresher.py']
                    
                    # Run the refresher's main function
                    # It will call parse_args() internally, which will get empty args (no --dry-run or --verbose)
                    refresher_exit_code = refresher_module.main()
                finally:
                    # Restore original argv
                    sys.argv = original_argv
                
                if refresher_exit_code == 0:
                    logger.info("")
                    logger.info("  ✓ Collection Refresher completed successfully")
                else:
                    logger.warning("")
                    logger.warning(f"  ⚠ Collection Refresher completed with exit code: {refresher_exit_code}")
                    logger.warning("  The main pipeline completed successfully, but collection refresh had issues")
            except KeyboardInterrupt:
                logger.warning("")
                logger.warning("  ⚠ Collection Refresher interrupted by user")
                logger.warning("  The main pipeline completed successfully")
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Collection Refresher failed: {type(e).__name__}: {e}")
                logger.error("  The main pipeline completed successfully, but collection refresh failed")
                logger.error("  You can run the refresher independently later if needed")
        else:
            logger.info("Collection Refresher skipped (disabled in config)")
            logger.info("  To enable: Set 'run_collection_refresher: true' in config/config.yaml")
            logger.info("  Or run independently: ./src/scripts/run_recently_watched_collections_refresher.sh")
        
        logger.info("")
        if exit_code == 0:
            logger.info("RECENTLY WATCHED COLLECTION SCRIPT END OK")
        else:
            logger.error("RECENTLY WATCHED COLLECTION SCRIPT END FAIL")
        logger.info("=" * 60)
        
        return exit_code
        
    except KeyboardInterrupt:
        logger.warning("\nScript interrupted by user")
        logger.error("RECENTLY WATCHED COLLECTION SCRIPT END (interrupted)")
        return 130
    except Exception as e:
        logger.exception("Unexpected error in main execution:")
        logger.error(f"RECENTLY WATCHED COLLECTION SCRIPT END FAIL")
        return 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
