from pathlib import Path
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.run_context import RunContext
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.tmdb_cache import TMDbCache
from tautulli_curated.helpers.recommender import get_recommendations
from tautulli_curated.helpers.plex_search import find_plex_movie
from tautulli_curated.helpers.plex_collection_manager import (
    update_points_data_for_run,
)
from plexapi.server import PlexServer
from plexapi.exceptions import NotFound
import tautulli_curated.helpers.radarr_utils as radarr_utils  # ✅ use ONE style

import json

logger = setup_logger("pipeline")


def load_points(path, logger):
    try:
        with open(str(path), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        logger.exception(f"Failed reading points file: {path}")
        return {}


def save_points(path, points_data, logger):
    try:
        with open(str(path), "w", encoding="utf-8") as f:
            json.dump(points_data, f, indent=2, ensure_ascii=False)
    except Exception:
        logger.exception(f"Failed writing points file: {path}")


def run_pipeline(movie_name, media_type, ctx=None):
    ctx = ctx or RunContext()

    # ✅ One stats dict for the pipeline (NOT the collection function return)
    pipeline_stats = {
        "recs": 0,
        "plex_found": 0,
        "plex_missing": 0,
        "radarr_added": 0,
        "radarr_monitored": 0,
        "radarr_already_monitored": 0,
        "radarr_failed": 0,
    }

    if media_type != "movie":
        logger.info(f"Skipping: media_type={media_type} title={movie_name!r}")
        return

    config = load_config()

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

    # TMDb cache file is hardcoded as tmdb_cache.json
    tmdb_cache_path = config.base_dir / "data" / "tmdb_cache.json"
    tmdb_cache = TMDbCache(config.tmdb.api_key, str(tmdb_cache_path))

    # Points file is hardcoded as recommendation_points.json
    points_path = config.base_dir / "data" / "recommendation_points.json"
    points_data = load_points(points_path, logger)
    logger.info(f"Loaded points entries={len(points_data)} from {points_path}")

    # --- Recommend
    with ctx.step(logger, "recommend", movie=movie_name):
        recs = get_recommendations(movie_name, plex=plex, tmdb_cache=tmdb_cache)


    pipeline_stats["recs"] = len(recs)

    # --- Plex lookup
    plex_movies = []
    missing_titles = []

    with ctx.step(logger, "plex_lookup", count=len(recs)):
        total = len(recs)
        for i, title in enumerate(recs, 1):
            movie = find_plex_movie(plex, title, library_name=config.plex.movie_library_name, logger=logger)
            if movie:
                plex_movies.append(movie)
            else:
                missing_titles.append(title)

            # progress every 5, and also at the end
            if i % 5 == 0 or i == total:
                logger.info(f"progress {i}/{total} found={len(plex_movies)} missing={len(missing_titles)}")

    pipeline_stats["plex_found"] = len(plex_movies)
    pipeline_stats["plex_missing"] = len(missing_titles)

    # --- Radarr for missing
    if missing_titles:
        with ctx.step(logger, "radarr_missing", missing=len(missing_titles)):
            radarr_result = radarr_utils.radarr_add_or_monitor_missing(config, missing_titles) or {}

        pipeline_stats["radarr_added"] += radarr_result.get("added", 0)
        pipeline_stats["radarr_monitored"] += radarr_result.get("monitored", 0)
        pipeline_stats["radarr_failed"] += radarr_result.get("failed", 0)
        
        if radarr_result.get("failed", 0) > 0:
            logger.warning(f"  ⚠ {radarr_result.get('failed', 0)} movies failed to add to Radarr (connection/timeout issues)")

    # --- Update points and clean up (deferred Plex collection update)
    with ctx.step(logger, "points_update", found=len(plex_movies)):
        algo_stats = update_points_data_for_run(
            points_data=points_data,
            suggested_movies=plex_movies,
            max_points=50,
            logger=logger,
        )

        collection_stats = {
            "suggested_now": algo_stats.get("suggested_now", 0),
            "reset_to_max": algo_stats.get("reset_to_max", 0),
            "decayed": algo_stats.get("decayed", 0),
            "removed_zero": algo_stats.get("removed", 0),
            "added_new": algo_stats.get("added", 0),
            "points_total": algo_stats.get("total", len(points_data)),
        }
        logger.info(f"points_update stats={collection_stats}")
        logger.info(f"Points updated in {points_path} (will be applied to Plex by Immaculate Taste Collection Refresher)")

    save_points(points_path, points_data, logger)
    logger.info(f"Saved points entries={len(points_data)} to {points_path}")

    tmdb_cache.save()

    # --- Final summary (very readable)
    logger.info("============ PIPELINE SUMMARY ============")
    logger.info(f"seed_title={movie_name!r}")
    logger.info(f"recommendations={pipeline_stats['recs']}")
    logger.info(f"plex_found={pipeline_stats['plex_found']} plex_missing={pipeline_stats['plex_missing']}")
    logger.info(
        "radarr_added=%d radarr_monitored=%d radarr_already_monitored=%d radarr_failed=%d",
        pipeline_stats["radarr_added"],
        pipeline_stats["radarr_monitored"],
        pipeline_stats["radarr_already_monitored"],
        pipeline_stats["radarr_failed"],
    )
    logger.info("==========================================")


