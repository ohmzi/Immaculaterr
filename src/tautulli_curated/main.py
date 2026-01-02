import sys
import time
from pathlib import Path
from datetime import datetime, timedelta
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.pipeline_recent_watch import run_pipeline
from tautulli_curated.helpers.config_loader import load_config

logger = setup_logger("main")


def cleanup_old_logs(logs_dir: Path, days: int = 15) -> tuple[int, int]:
    """
    Remove log files older than specified days.
    
    Args:
        logs_dir: Directory containing log files
        days: Number of days to keep logs (default: 15)
    
    Returns:
        Tuple of (files_deleted, total_size_freed_bytes)
    """
    if not logs_dir.exists() or not logs_dir.is_dir():
        return 0, 0
    
    cutoff_date = datetime.now() - timedelta(days=days)
    files_deleted = 0
    total_size = 0
    
    try:
        for log_file in logs_dir.glob("*.log"):
            try:
                # Get file modification time
                mtime = datetime.fromtimestamp(log_file.stat().st_mtime)
                
                if mtime < cutoff_date:
                    file_size = log_file.stat().st_size
                    log_file.unlink()
                    files_deleted += 1
                    total_size += file_size
                    logger.debug(f"Deleted old log: {log_file.name} (age: {(datetime.now() - mtime).days} days, size: {file_size} bytes)")
            except (OSError, ValueError) as e:
                logger.warning(f"Failed to delete log file {log_file.name}: {e}")
                continue
    
    except Exception as e:
        logger.warning(f"Error during log cleanup: {e}")
    
    return files_deleted, total_size

def main():
    # Expect: python3 tautulli_immaculate_taste_collection.py "Title" {movie|episode}
    if len(sys.argv) < 3:
        print('Usage: python3 tautulli_immaculate_taste_collection.py "Title" movie')
        print('   or: python3 tautulli_immaculate_taste_collection.py "Show - Episode Title" episode')
        return 30

    seed_title = sys.argv[1]
    media_type = sys.argv[2].lower().strip()
    script_start_time = time.time()
    exit_code = 0

    logger.info("=" * 60)
    logger.info("TAUTULLI CURATED COLLECTION SCRIPTS START")
    logger.info("=" * 60)
    logger.info(f"Title: {seed_title}")
    logger.info(f"Media type: {media_type}")
    logger.info("")

    # Early exit if media type is not supported
    if media_type not in ("movie", "episode"):
        logger.info(f"This script only processes movies and TV episode triggers. Detected media type: '{media_type}'")
        logger.info("Skipping entire script - no actions will be performed.")
        logger.info("=" * 60)
        logger.info("TAUTULLI CURATED COLLECTION SCRIPTS END (skipped - unsupported media type)")
        logger.info("=" * 60)
        return 0

    try:
        # Load configuration
        logger.info("Loading configuration...")
        config = load_config()
        logger.info(f"  ✓ Configuration loaded")
        logger.info("")
        
        # Clean up old log files (older than 15 days)
        logs_dir = config.base_dir / "data" / "logs"
        if logs_dir.exists():
            logger.info("Cleaning up old log files (older than 15 days)...")
            files_deleted, size_freed = cleanup_old_logs(logs_dir, days=15)
            if files_deleted > 0:
                size_mb = size_freed / (1024 * 1024)
                logger.info(f"  ✓ Deleted {files_deleted} old log file(s), freed {size_mb:.2f} MB")
            else:
                logger.info(f"  ✓ No old log files to clean up")
            logger.info("")
        
        # Check which scripts should run
        # Movie triggers run the full movie pipeline; episode triggers run ONLY TV pipeline + optional TV refresher.
        if media_type == "movie":
            run_recently_watched = config.scripts_run.run_recently_watched_collection
            run_duplicate_cleaner = config.scripts_run.run_plex_duplicate_cleaner
            run_radarr_confirm = config.scripts_run.run_radarr_monitor_confirm_plex
            run_sonarr_duplicate_cleaner = config.scripts_run.run_sonarr_duplicate_cleaner
            run_sonarr_confirm = config.scripts_run.run_sonarr_monitor_confirm_plex
            run_sonarr_search = config.scripts_run.run_sonarr_search_monitored
            run_immaculate_taste = config.scripts_run.run_immaculate_taste_collection
            run_immaculate_refresher = config.scripts_run.run_collection_refresher
            run_recently_watched_refresher = config.scripts_run.run_recently_watched_refresher
            run_tv_immaculate_taste = False
            run_tv_refresher = False
        else:
            # episode trigger
            run_recently_watched = False
            run_duplicate_cleaner = False
            run_radarr_confirm = False
            run_sonarr_duplicate_cleaner = False
            run_sonarr_confirm = False
            run_sonarr_search = False
            run_immaculate_taste = False
            run_immaculate_refresher = False
            run_recently_watched_refresher = False
            run_tv_immaculate_taste = config.scripts_run.run_tv_immaculate_taste_collection
            run_tv_refresher = config.scripts_run.run_tv_collection_refresher
        
        logger.info("Script Execution Configuration:")
        if media_type == "movie":
            logger.info(f"  {'✓' if run_recently_watched else '✗'} Recently Watched Collection: {'ENABLED' if run_recently_watched else 'DISABLED'}")
            logger.info(f"  {'✓' if run_duplicate_cleaner else '✗'} Plex Duplicate Cleaner: {'ENABLED' if run_duplicate_cleaner else 'DISABLED'}")
            logger.info(f"  {'✓' if run_radarr_confirm else '✗'} Radarr Monitor Confirm: {'ENABLED' if run_radarr_confirm else 'DISABLED'}")
            logger.info(f"  {'✓' if run_sonarr_duplicate_cleaner else '✗'} Sonarr Duplicate Cleaner: {'ENABLED' if run_sonarr_duplicate_cleaner else 'DISABLED'}")
            logger.info(f"  {'✓' if run_sonarr_confirm else '✗'} Sonarr Monitor Confirm: {'ENABLED' if run_sonarr_confirm else 'DISABLED'}")
            logger.info(f"  {'✓' if run_sonarr_search else '✗'} Sonarr Search Monitored: {'ENABLED' if run_sonarr_search else 'DISABLED'}")
            logger.info(f"  {'✓' if run_immaculate_taste else '✗'} Immaculate Taste Collection: {'ENABLED' if run_immaculate_taste else 'DISABLED'}")
            logger.info(f"  {'✓' if run_recently_watched_refresher else '✗'} Recently Watched Refresher: {'ENABLED' if run_recently_watched_refresher else 'DISABLED'}")
            logger.info(f"  {'✓' if run_immaculate_refresher else '✗'} Immaculate Taste Refresher: {'ENABLED' if run_immaculate_refresher else 'DISABLED'}")
        else:
            logger.info(f"  {'✓' if run_tv_immaculate_taste else '✗'} TV Immaculate Taste Collection: {'ENABLED' if run_tv_immaculate_taste else 'DISABLED'}")
            logger.info(f"  {'✓' if run_tv_refresher else '✗'} TV Immaculate Taste Refresher: {'ENABLED' if run_tv_refresher else 'DISABLED'}")
        logger.info("")
        logger.info("Execution Order:")
        if media_type == "movie":
            logger.info("  1. Recently Watched Collection (if enabled)")
            logger.info("  2. Plex Duplicate Cleaner (if enabled)")
            logger.info("  3. Radarr Monitor Confirm (if enabled)")
            logger.info("  4. Sonarr Duplicate Cleaner (if enabled)")
            logger.info("  5. Sonarr Monitor Confirm (if enabled)")
            logger.info("  6. Sonarr Search Monitored (if enabled)")
            logger.info("  7. Immaculate Taste Collection (if enabled)")
            logger.info("  8a. Recently Watched Collection Refresher (if enabled - smaller/quicker)")
            logger.info("  8b. Immaculate Taste Collection Refresher (if enabled - larger/takes longer)")
        else:
            logger.info("  1. TV Immaculate Taste Collection (if enabled)")
            logger.info("  2. TV Immaculate Taste Refresher (if enabled)")
        logger.info("")
        
        # Run Recently Watched Collection script first (smaller/quicker) - MOVIES ONLY
        if media_type == "movie" and run_recently_watched:
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
                    sys.argv = ['recently_watched_collection.py', seed_title, media_type]
                    
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
                exit_code = max(exit_code, 30)
        elif media_type == "movie":
            logger.info("Recently Watched Collection script skipped (disabled in config)")
            logger.info("")
        
        # Run Plex Duplicate Cleaner
        if media_type == "movie" and run_duplicate_cleaner:
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
                exit_code = max(exit_code, 30)
        elif media_type == "movie":
            logger.info("Plex Duplicate Cleaner skipped (disabled in config)")
            logger.info("")
        
        # Run Radarr Monitor Confirm
        if media_type == "movie" and run_radarr_confirm:
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
                exit_code = max(exit_code, 30)
        elif media_type == "movie":
            logger.info("Radarr Monitor Confirm skipped (disabled in config)")
            logger.info("")
        
        # Run Sonarr Duplicate Cleaner
        if media_type == "movie" and run_sonarr_duplicate_cleaner:
            logger.info("=" * 60)
            logger.info("RUNNING SONARR DUPLICATE CLEANER")
            logger.info("=" * 60)
            logger.info("This script will:")
            logger.info("  - Scan Plex TV shows library for duplicate episodes")
            logger.info("  - Delete lower quality duplicates based on preferences")
            logger.info("  - Unmonitor episodes in Sonarr after deletion")
            logger.info("")
            
            try:
                from tautulli_curated.helpers.sonarr_duplicate_cleaner import run_sonarr_duplicate_cleaner
                
                dup_found, dup_removed = run_sonarr_duplicate_cleaner(config=config, log_parent=logger)
                
                if dup_found > 0:
                    logger.info("")
                    logger.info(f"  ✓ Sonarr Duplicate Cleaner completed: Found {dup_found} duplicates, Removed {dup_removed}")
                else:
                    logger.info("")
                    logger.info("  ✓ Sonarr Duplicate Cleaner completed: No duplicates found")
            except KeyboardInterrupt:
                logger.warning("")
                logger.warning("  ⚠ Sonarr Duplicate Cleaner interrupted by user")
                exit_code = 130
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Sonarr Duplicate Cleaner failed: {type(e).__name__}: {e}")
                logger.error("  Continuing with next script...")
                exit_code = max(exit_code, 30)
        elif media_type == "movie":
            logger.info("Sonarr Duplicate Cleaner skipped (disabled in config)")
            logger.info("")
        
        # Run Sonarr Monitor Confirm
        if media_type == "movie" and run_sonarr_confirm:
            logger.info("=" * 60)
            logger.info("RUNNING SONARR MONITOR CONFIRM")
            logger.info("=" * 60)
            logger.info("This script will:")
            logger.info("  - Check all monitored series and episodes in Sonarr")
            logger.info("  - Unmonitor episodes that already exist in Plex")
            logger.info("")
            
            try:
                from tautulli_curated.helpers.sonarr_monitor_confirm import run_sonarr_monitor_confirm
                
                total_series, episodes_checked, episodes_in_plex, episodes_unmonitored, series_with_missing = run_sonarr_monitor_confirm(
                    config=config, dry_run=False, log_parent=logger
                )
                
                logger.info("")
                logger.info(f"  ✓ Sonarr Monitor Confirm completed:")
                logger.info(f"    - Total monitored series: {total_series}")
                logger.info(f"    - Total episodes checked: {episodes_checked}")
                logger.info(f"    - Episodes found in Plex: {episodes_in_plex}")
                logger.info(f"    - Episodes unmonitored: {episodes_unmonitored}")
                logger.info(f"    - Series with missing episodes (kept monitored): {series_with_missing}")
            except KeyboardInterrupt:
                logger.warning("")
                logger.warning("  ⚠ Sonarr Monitor Confirm interrupted by user")
                exit_code = 130
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Sonarr Monitor Confirm failed: {type(e).__name__}: {e}")
                logger.error("  Continuing with next script...")
                exit_code = max(exit_code, 30)
        elif media_type == "movie":
            logger.info("Sonarr Monitor Confirm skipped (disabled in config)")
            logger.info("")
        
        # Run Sonarr Search Monitored
        if media_type == "movie" and run_sonarr_search:
            logger.info("=" * 60)
            logger.info("RUNNING SONARR SEARCH MONITORED")
            logger.info("=" * 60)
            logger.info("This script will:")
            logger.info("  - Trigger a search for all missing monitored episodes in Sonarr")
            logger.info("")
            
            try:
                from tautulli_curated.helpers.sonarr_utils import sonarr_search_monitored_episodes
                
                success = sonarr_search_monitored_episodes(config)
                
                if success:
                    logger.info("")
                    logger.info("  ✓ Sonarr Search Monitored completed: Search command queued successfully")
                else:
                    logger.warning("")
                    logger.warning("  ⚠ Sonarr Search Monitored completed with warnings: Failed to queue search command")
                    exit_code = max(exit_code, 20)
            except KeyboardInterrupt:
                logger.warning("")
                logger.warning("  ⚠ Sonarr Search Monitored interrupted by user")
                exit_code = 130
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Sonarr Search Monitored failed: {type(e).__name__}: {e}")
                logger.error("  Continuing with next script...")
                exit_code = max(exit_code, 30)
        elif media_type == "movie":
            logger.info("Sonarr Search Monitored skipped (disabled in config)")
            logger.info("")
        
        # Run Immaculate Taste Collection script (main pipeline) - MOVIES ONLY
        if media_type == "movie" and run_immaculate_taste:
            logger.info("=" * 60)
            logger.info("RUNNING IMMACULATE TASTE COLLECTION SCRIPT")
            logger.info("=" * 60)
            logger.info("Running main pipeline...")
            logger.info("-" * 60)
            try:
                run_pipeline(seed_title, media_type)
                logger.info("-" * 60)
                logger.info("  ✓ Main pipeline completed successfully")
                logger.info("")
            except Exception as e:
                logger.error("")
                logger.error(f"  ✗ Main pipeline failed: {type(e).__name__}: {e}")
                logger.exception("Full traceback:")
                exit_code = max(exit_code, 30)
        elif media_type == "movie":
            logger.info("Immaculate Taste Collection script skipped (disabled in config)")
            logger.info("")
        
        # Optionally run collection refreshers
        # Run smaller refreshers first (Recently Watched), then larger one (Immaculate Taste)
        
        if media_type == "movie" and run_recently_watched_refresher:
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
                exit_code = max(exit_code, 30)

        if media_type == "movie" and run_immaculate_refresher:
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
                exit_code = max(exit_code, 30)

        # TV pipeline + refresher (episode triggers only)
        if media_type == "episode":
            if run_tv_immaculate_taste:
                logger.info("=" * 60)
                logger.info("RUNNING TV IMMACULATE TASTE COLLECTION SCRIPT")
                logger.info("=" * 60)
                logger.info("Running TV pipeline...")
                logger.info("-" * 60)
                try:
                    from tautulli_curated.helpers.pipeline_tv_immaculate import run_tv_pipeline
                    tv_stats = run_tv_pipeline(seed_title, media_type) or {}
                    # Best-effort partial signaling when Sonarr automation was enabled but had failures.
                    try:
                        sonarr_failed = int((tv_stats or {}).get("sonarr_failed", 0) or 0)
                        search_failed = int((tv_stats or {}).get("sonarr_search_failed", 0) or 0)
                        if sonarr_failed > 0 or search_failed > 0:
                            exit_code = max(exit_code, 10)
                    except Exception:
                        pass
                    logger.info("-" * 60)
                    logger.info("  ✓ TV pipeline completed successfully")
                    logger.info("")
                except Exception as e:
                    logger.error("")
                    logger.error(f"  ✗ TV pipeline failed: {type(e).__name__}: {e}")
                    logger.exception("Full traceback:")
                    exit_code = max(exit_code, 30)
            else:
                logger.info("TV Immaculate Taste Collection script skipped (disabled in config)")
                logger.info("")

            if run_tv_refresher:
                logger.info("=" * 60)
                logger.info("RUNNING TV IMMACULATE TASTE COLLECTION REFRESHER")
                logger.info("=" * 60)
                logger.info("Starting TV Immaculate Taste Collection Refresher...")
                logger.info("")
                try:
                    from tautulli_curated.helpers import tv_immaculate_taste_refresher as tv_refresher_module
                    original_argv = sys.argv
                    try:
                        sys.argv = ['tv_immaculate_taste_refresher.py']
                        tv_refresher_exit_code = tv_refresher_module.main()
                    finally:
                        sys.argv = original_argv

                    if tv_refresher_exit_code == 0:
                        logger.info("")
                        logger.info("  ✓ TV Immaculate Taste Collection Refresher completed successfully")
                    else:
                        logger.warning("")
                        logger.warning(f"  ⚠ TV Immaculate Taste Collection Refresher completed with exit code: {tv_refresher_exit_code}")
                        exit_code = max(exit_code, tv_refresher_exit_code)
                except KeyboardInterrupt:
                    logger.warning("")
                    logger.warning("  ⚠ TV Immaculate Taste Collection Refresher interrupted by user")
                    exit_code = max(exit_code, 130)
                except Exception as e:
                    logger.error("")
                    logger.error(f"  ✗ TV Immaculate Taste Collection Refresher failed: {type(e).__name__}: {e}")
                    exit_code = max(exit_code, 30)
            else:
                logger.info("TV Immaculate Taste Collection Refresher skipped (disabled in config)")
                logger.info("")
        
        # Final summary
        elapsed_time = time.time() - script_start_time
        logger.info("")
        logger.info("=" * 60)
        logger.info("TAUTULLI CURATED COLLECTION SCRIPTS SUMMARY")
        logger.info("=" * 60)
        logger.info("Execution Summary:")
        if media_type == "movie":
            logger.info(f"  - Recently Watched Collection: {'✓ Completed' if run_recently_watched else '✗ Skipped'}")
            logger.info(f"  - Plex Duplicate Cleaner: {'✓ Completed' if run_duplicate_cleaner else '✗ Skipped'}")
            logger.info(f"  - Radarr Monitor Confirm: {'✓ Completed' if run_radarr_confirm else '✗ Skipped'}")
            logger.info(f"  - Sonarr Duplicate Cleaner: {'✓ Completed' if run_sonarr_duplicate_cleaner else '✗ Skipped'}")
            logger.info(f"  - Sonarr Monitor Confirm: {'✓ Completed' if run_sonarr_confirm else '✗ Skipped'}")
            logger.info(f"  - Sonarr Search Monitored: {'✓ Completed' if run_sonarr_search else '✗ Skipped'}")
            logger.info(f"  - Immaculate Taste Collection: {'✓ Completed' if run_immaculate_taste else '✗ Skipped'}")
            logger.info(f"  - Collection Refreshers: {'✓ Completed' if (run_immaculate_refresher or run_recently_watched_refresher) else '✗ Skipped'}")
        else:
            logger.info(f"  - TV Immaculate Taste Collection: {'✓ Completed' if run_tv_immaculate_taste else '✗ Skipped'}")
            logger.info(f"  - TV Immaculate Taste Refresher: {'✓ Completed' if run_tv_refresher else '✗ Skipped'}")
        logger.info("")
        logger.info(f"Total execution time: {elapsed_time:.1f} seconds")
        logger.info("=" * 60)
        
        if exit_code == 0:
            logger.info("TAUTULLI CURATED COLLECTION SCRIPTS END OK")
        elif exit_code == 10:
            logger.warning("TAUTULLI CURATED COLLECTION SCRIPTS END PARTIAL")
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
        return 30

if __name__ == "__main__":
    raise SystemExit(main())


