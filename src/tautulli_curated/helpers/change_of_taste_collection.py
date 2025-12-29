import sys
import json
from pathlib import Path
from tautulli_curated.helpers.chatgpt_utils import get_related_movies
from tautulli_curated.helpers.radarr_utils import radarr_add_or_monitor_missing
from tautulli_curated.helpers.plex_search import find_plex_movie
from tautulli_curated.helpers.logger import setup_logger
from plexapi.server import PlexServer

logger = setup_logger("change_of_taste_collection")

RADARR_TAGS = ["movies", "change-of-taste"]
COLLECTION_NAME = "Change of Taste"
JSON_FILE = "change_of_taste_collection.json"


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


def get_contrast_movies(movie_name: str, api_key: str, max_results: int = 15):
    """
    Get contrast movies (different genre/style) using OpenAI.
    Uses a custom prompt to get movies that are opposite in tone/genre.
    """
    from openai import OpenAI
    from tautulli_curated.helpers.chatgpt_utils import parse_recommendations
    
    if not api_key:
        logger.error("OpenAI API key not provided; cannot fetch contrast recommendations.")
        return []
    
    client = OpenAI(api_key=api_key)
    prompt = (
        f"Recommend {max_results} movies that offer a deliberate 'change of taste' from '{movie_name}'. "
        "These should be opposite in tone, genre, pacing, or style. "
        "For example, if the movie is dark and serious, recommend light comedies or uplifting films. "
        "If it's action-packed, recommend slow-burn dramas or contemplative films. "
        "If it's realistic, recommend fantasy or sci-fi. "
        "Return ONLY a plain newline-separated list of movie titles (no extra text, no numbering). "
        "Do not include years unless necessary to disambiguate titles."
    )
    
    try:
        resp = client.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {"role": "system", "content": "You are a movie recommendation engine."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.8,
        )
        
        text = resp.choices[0].message.content or ""
        recs = parse_recommendations(text, limit=max_results)
        
        logger.info(f"OpenAI returned {len(recs)} contrast recommendations for '{movie_name}'")
        return recs
    except Exception as e:
        logger.error(f"Error getting contrast recommendations: {e}")
        return []


def run_change_of_taste_collection(movie_name: str, config, max_results: int = 15):
    """
    Process change of taste collection recommendations.
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
        
        # Get recommendations from ChatGPT
        logger.info("Step 1: Getting contrast recommendations from ChatGPT...")
        recommendations = get_contrast_movies(movie_name, config.openai.api_key, max_results=max_results)
        logger.info(f"  ✓ ChatGPT returned {len(recommendations)} contrast recommendations")

        collection_movies = []
        missing_in_plex = []
        missing_seen = set()

        # 1) Plex-first pass
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

        # 2) Deduplicate missing list (preserve order)
        deduped = []
        seen = set()
        for t in missing_in_plex:
            tl = t.lower()
            if tl in seen:
                continue
            seen.add(tl)
            deduped.append(t)
        missing_in_plex = deduped

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

        # 3) Radarr processing for missing titles
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
        logger.exception(f"Error in run_change_of_taste_collection: {e}")
        raise


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python3 tautulli_change_of_taste_collection.py "Movie Name"')
        sys.exit(1)

    movie_name = sys.argv[1]
    run_change_of_taste_collection(movie_name, max_results=15)

