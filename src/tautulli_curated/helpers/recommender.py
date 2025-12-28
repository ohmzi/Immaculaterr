# helpers/recommender.py
from tautulli_curated.helpers.chatgpt_utils import get_related_movies
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.tmdb_recommender import get_tmdb_recommendations_advanced

logger = setup_logger("recommender")


def get_recommendations(movie_name: str, *, plex=None, tmdb_cache=None) -> list[str]:
    config = load_config()

    # 1) OpenAI first
    recs = get_related_movies(
        movie_name,
        api_key=config.openai.api_key,
        model=getattr(config.openai, "model", "gpt-5.2"),
        limit=config.openai.recommendation_count,
    )
    cleaned = [r.split("(")[0].strip() for r in recs if r and r.strip()]

    if cleaned:
        logger.info(f"Using OpenAI recommendations returned={len(cleaned)}")
        return cleaned

    # 2) TMDb fallback (advanced)
    logger.warning("OpenAI unavailable/empty -> using TMDb advanced fallback")

    if tmdb_cache is None:
        logger.error("tmdb_cache not provided; cannot score by vote_average")
        return []

    tmdb_titles = get_tmdb_recommendations_advanced(
        api_key=config.tmdb.api_key,
        seed_title=movie_name,
        tmdb_cache=tmdb_cache,
        limit=config.tmdb.recommendation_count,  # ✅ config-driven
        plex=plex,                            # ✅ filter out already-in-Plex
    )

    logger.info(f"Using TMDb recommendations returned={len(tmdb_titles)}")
    return tmdb_titles

