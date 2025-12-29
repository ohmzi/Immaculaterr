import sys
import time
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.pipeline_recent_watch import run_pipeline
from tautulli_curated.helpers.config_loader import load_config

logger = setup_logger("main")

def main():
    # Expect: python3 tautulli_immaculate_taste_collection.py "Title" movie
    if len(sys.argv) < 3:
        print('Usage: python3 tautulli_immaculate_taste_collection.py "Movie Title" movie')
        return 1

    movie_name = sys.argv[1]
    media_type = sys.argv[2].lower().strip()
    script_start_time = time.time()
    exit_code = 0

    logger.info("=" * 60)
    logger.info("TAUTULLI CURATED COLLECTION SCRIPTS START")
    logger.info("=" * 60)
    logger.info(f"Movie: {movie_name}")
    logger.info(f"Media type: {media_type}")
    logger.info("")

    # Early exit if media type is not "movie"
    if media_type not in ("movie",):
        logger.info(f"This script only processes movies. Detected media type: '{media_type}' (episode/show)")
        logger.info("Skipping entire script - no actions will be performed.")
        logger.info("=" * 60)
        logger.info("TAUTULLI CURATED COLLECTION SCRIPTS END (skipped - not a movie)")
        logger.info("=" * 60)
        return 0

    try:
        # Load configuration
        logger.info("Loading configuration...")
        config = load_config()
        logger.info(f"  ✓ Configuration loaded")
        logger.info("")
        
        # Check which scripts should run
        run_recently_watched = config.scripts_run.run_recently_watched_collection
        run_duplicate_cleaner = config.scripts_run.run_plex_duplicate_cleaner
        run_radarr_confirm = config.scripts_run.run_radarr_monitor_confirm_plex
        run_immaculate_taste = config.scripts_run.run_immaculate_taste_collection
        run_immaculate_refresher = config.scripts_run.run_collection_refresher
        run_recently_watched_refresher = config.scripts_run.run_recently_watched_refresher
        
        logger.info("Script Execution Configuration:")
        logger.info(f"  {'✓' if run_recently_watched else '✗'} Recently Watched Collection: {'ENABLED' if run_recently_watched else 'DISABLED'}")
        logger.info(f"  {'✓' if run_duplicate_cleaner else '✗'} Plex Duplicate Cleaner: {'ENABLED' if run_duplicate_cleaner else 'DISABLED'}")
        logger.info(f"  {'✓' if run_radarr_confirm else '✗'} Radarr Monitor Confirm: {'ENABLED' if run_radarr_confirm else 'DISABLED'}")
        logger.info(f"  {'✓' if run_immaculate_taste else '✗'} Immaculate Taste Collection: {'ENABLED' if run_immaculate_taste else 'DISABLED'}")
        logger.info(f"  {'✓' if run_recently_watched_refresher else '✗'} Recently Watched Refresher: {'ENABLED' if run_recently_watched_refresher else 'DISABLED'}")
        logger.info(f"  {'✓' if run_immaculate_refresher else '✗'} Immaculate Taste Refresher: {'ENABLED' if run_immaculate_refresher else 'DISABLED'}")
        logger.info("")
        logger.info("Execution Order:")
        logger.info("  1. Recently Watched Collection (if enabled)")
        logger.info("  2. Plex Duplicate Cleaner (if enabled)")
        logger.info("  3. Radarr Monitor Confirm (if enabled)")
        logger.info("  4. Immaculate Taste Collection (if enabled)")
        logger.info("  5a. Recently Watched Collection Refresher (if enabled - smaller/quicker)")
        logger.info("  5b. Immaculate Taste Collection Refresher (if enabled - larger/takes longer)")
        logger.info("")
        
        # Run Recently Watched Collection script first (smaller/quicker)
        if run_recently_watched:
            logger.info("=" * 60)
            logger.info("RUNNING RECENTLY WATCHED COLLECTION SCRIPT")
            logger.info("=" * 60)
            logger.info("This script generates recommendations for:")
            logger.info("  - 'Based on your recently watched movie' collection")
            logger.info("  - 'Change of Taste' collection")
            logger.info("")
            
            try:
                from tautulli_curated.helpers.recently_watched_collection import main as recently_watched_main
                
                # Save original argv
                original_argv = sys.argv
                try:
                    # Set up argv for recently_watched script (it expects movie_name and optional media_type)
                    sys.argv = ['recently_watched_collection.py', movie_name, media_type]
                    
                    # Run the recently watched collection script
                    recently_watched_exit_code = recently_watched_main()
                    
                    if recently_watched_exit_code == 0:
                        logger.info("")
                        logger.info("  ✓ Recently Watched Collection script completed successfully")
                    else:
                        logger.warning("")
                        logger.warning(f"  ⚠ Recently Watched Collection script completed with exit code: {recently_watched_exit_code}")
                        exit_code = max(exit_code, recently_watched_exit_code)
                finally:
                    # Restore original argv
                    sys.argv = original_argv
                    
            except KeyboardInterrupt:
                logger.warning("")
                logger.warning("  ⚠ Recently Watched Collection script interrupted by user")
                exit_code = 130
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Recently Watched Collection script failed: {type(e).__name__}: {e}")
                logger.error("  Continuing with Immaculate Taste Collection script...")
                exit_code = max(exit_code, 1)
        else:
            logger.info("Recently Watched Collection script skipped (disabled in config)")
            logger.info("")
        
        # Run Plex Duplicate Cleaner
        if run_duplicate_cleaner:
            logger.info("=" * 60)
            logger.info("RUNNING PLEX DUPLICATE CLEANER")
            logger.info("=" * 60)
            logger.info("This script will:")
            logger.info("  - Scan Plex library for duplicate movies")
            logger.info("  - Delete lower quality duplicates based on preferences")
            logger.info("  - Unmonitor movies in Radarr after deletion")
            logger.info("")
            
            try:
                from tautulli_curated.helpers.plex_duplicate_cleaner import run_plex_duplicate_cleaner
                
                dup_found, dup_removed = run_plex_duplicate_cleaner(config=config, log_parent=logger)
                
                if dup_found > 0:
                    logger.info("")
                    logger.info(f"  ✓ Duplicate Cleaner completed: Found {dup_found} duplicates, Removed {dup_removed}")
                else:
                    logger.info("")
                    logger.info("  ✓ Duplicate Cleaner completed: No duplicates found")
            except KeyboardInterrupt:
                logger.warning("")
                logger.warning("  ⚠ Duplicate Cleaner interrupted by user")
                exit_code = 130
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Duplicate Cleaner failed: {type(e).__name__}: {e}")
                logger.error("  Continuing with next script...")
                exit_code = max(exit_code, 1)
        else:
            logger.info("Plex Duplicate Cleaner skipped (disabled in config)")
            logger.info("")
        
        # Run Radarr Monitor Confirm
        if run_radarr_confirm:
            logger.info("=" * 60)
            logger.info("RUNNING RADARR MONITOR CONFIRM")
            logger.info("=" * 60)
            logger.info("This script will:")
            logger.info("  - Check all monitored movies in Radarr")
            logger.info("  - Unmonitor movies that already exist in Plex")
            logger.info("")
            
            try:
                from tautulli_curated.helpers.radarr_monitor_confirm import run_radarr_monitor_confirm
                
                total_monitored, in_plex, unmonitored = run_radarr_monitor_confirm(config=config, dry_run=False, log_parent=logger)
                
                logger.info("")
                logger.info(f"  ✓ Radarr Monitor Confirm completed:")
                logger.info(f"    - Total monitored: {total_monitored}")
                logger.info(f"    - Already in Plex: {in_plex}")
                logger.info(f"    - Unmonitored: {unmonitored}")
            except KeyboardInterrupt:
                logger.warning("")
                logger.warning("  ⚠ Radarr Monitor Confirm interrupted by user")
                exit_code = 130
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Radarr Monitor Confirm failed: {type(e).__name__}: {e}")
                logger.error("  Continuing with next script...")
                exit_code = max(exit_code, 1)
        else:
            logger.info("Radarr Monitor Confirm skipped (disabled in config)")
            logger.info("")
        
        # Run Immaculate Taste Collection script (main pipeline)
        if run_immaculate_taste:
            logger.info("=" * 60)
            logger.info("RUNNING IMMACULATE TASTE COLLECTION SCRIPT")
            logger.info("=" * 60)
            logger.info("Running main pipeline...")
            logger.info("-" * 60)
            try:
                run_pipeline(movie_name, media_type)
                logger.info("-" * 60)
                logger.info("  ✓ Main pipeline completed successfully")
                logger.info("")
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Main pipeline failed: {type(e).__name__}: {e}")
                logger.exception("Full traceback:")
                exit_code = max(exit_code, 1)
        else:
            logger.info("Immaculate Taste Collection script skipped (disabled in config)")
            logger.info("")
        
        # Optionally run collection refreshers
        # Run smaller refreshers first (Recently Watched), then larger one (Immaculate Taste)
        
        if run_recently_watched_refresher:
            logger.info("=" * 60)
            logger.info("RUNNING RECENTLY WATCHED COLLECTION REFRESHER")
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
                from tautulli_curated.helpers import recently_watched_collections_refresher as recently_watched_refresher_module
                
                original_argv = sys.argv
                try:
                    sys.argv = ['recently_watched_collections_refresher.py']
                    recently_watched_refresher_exit_code = recently_watched_refresher_module.main()
                finally:
                    sys.argv = original_argv
                
                if recently_watched_refresher_exit_code == 0:
                    logger.info("")
                    logger.info("  ✓ Recently Watched Collection Refresher completed successfully")
                else:
                    logger.warning("")
                    logger.warning(f"  ⚠ Recently Watched Collection Refresher completed with exit code: {recently_watched_refresher_exit_code}")
                    exit_code = max(exit_code, recently_watched_refresher_exit_code)
            except KeyboardInterrupt:
                logger.warning("")
                logger.warning("  ⚠ Recently Watched Collection Refresher interrupted by user")
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Recently Watched Collection Refresher failed: {type(e).__name__}: {e}")
                exit_code = max(exit_code, 1)

        if run_immaculate_refresher:
            logger.info("=" * 60)
            logger.info("RUNNING IMMACULATE TASTE COLLECTION REFRESHER")
            logger.info("=" * 60)
            logger.info("Starting Immaculate Taste Collection Refresher...")
            logger.info("  This will:")
            logger.info("    1. Read recommendation_points.json")
            logger.info("    2. Randomize the order of movies")
            logger.info("    3. Remove all items from the Plex collection")
            logger.info("    4. Add all items back in randomized order")
            logger.info("  Note: This process may take a while for large collections")
            logger.info("")
            
            try:
                from tautulli_curated.helpers import immaculate_taste_refresher as refresher_module
                
                original_argv = sys.argv
                try:
                    sys.argv = ['immaculate_taste_refresher.py']
                    refresher_exit_code = refresher_module.main()
                finally:
                    sys.argv = original_argv
                
                if refresher_exit_code == 0:
                    logger.info("")
                    logger.info("  ✓ Immaculate Taste Collection Refresher completed successfully")
                else:
                    logger.warning("")
                    logger.warning(f"  ⚠ Immaculate Taste Collection Refresher completed with exit code: {refresher_exit_code}")
                    exit_code = max(exit_code, refresher_exit_code)
            except KeyboardInterrupt:
                logger.warning("")
                logger.warning("  ⚠ Immaculate Taste Collection Refresher interrupted by user")
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Immaculate Taste Collection Refresher failed: {type(e).__name__}: {e}")
                exit_code = max(exit_code, 1)
        
        # Final summary
        elapsed_time = time.time() - script_start_time
        logger.info("")
        logger.info("=" * 60)
        logger.info("TAUTULLI CURATED COLLECTION SCRIPTS SUMMARY")
        logger.info("=" * 60)
        logger.info("Execution Summary:")
        logger.info(f"  - Recently Watched Collection: {'✓ Completed' if run_recently_watched else '✗ Skipped'}")
        logger.info(f"  - Plex Duplicate Cleaner: {'✓ Completed' if run_duplicate_cleaner else '✗ Skipped'}")
        logger.info(f"  - Radarr Monitor Confirm: {'✓ Completed' if run_radarr_confirm else '✗ Skipped'}")
        logger.info(f"  - Immaculate Taste Collection: {'✓ Completed' if run_immaculate_taste else '✗ Skipped'}")
        logger.info(f"  - Collection Refreshers: {'✓ Completed' if (run_immaculate_refresher or run_recently_watched_refresher) else '✗ Skipped'}")
        logger.info("")
        logger.info(f"Total execution time: {elapsed_time:.1f} seconds")
        logger.info("=" * 60)
        
        if exit_code == 0:
            logger.info("TAUTULLI CURATED COLLECTION SCRIPTS END OK")
        else:
            logger.error("TAUTULLI CURATED COLLECTION SCRIPTS END WITH ERRORS")
        logger.info("=" * 60)
        return exit_code
    except KeyboardInterrupt:
        logger.warning("")
        logger.warning("Script interrupted by user")
        logger.info("=" * 60)
        logger.info("IMMACULATE TASTE COLLECTION SCRIPT END (interrupted)")
        logger.info("=" * 60)
        return 130
    except Exception:
        logger.exception("")
        logger.error("=" * 60)
        logger.error("IMMACULATE TASTE COLLECTION SCRIPT END FAIL")
        logger.error("=" * 60)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())


