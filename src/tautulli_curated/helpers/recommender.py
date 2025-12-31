# helpers/recommender.py
import datetime

from tautulli_curated.helpers.chatgpt_utils import get_related_movies
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.tmdb_recommender import get_tmdb_recommendations_advanced
from tautulli_curated.helpers.tmdb_client import search_movie, get_movie
from tautulli_curated.helpers.google_search import google_custom_search_with_meta, format_search_results_for_prompt

logger = setup_logger("recommender")


def _tmdb_seed_metadata(api_key: str, seed_title: str) -> dict:
    """
    Best-effort TMDb lookup for prompt context.
    Returns a small dict (title, year, genres, overview).
    """
    try:
        results = search_movie(api_key, seed_title) or []
        if not results:
            return {"seed_title": seed_title}
        tmdb_id = int(results[0]["id"])
        data = get_movie(api_key, tmdb_id) or {}
        genres = [g.get("name") for g in (data.get("genres") or []) if isinstance(g, dict) and g.get("name")]
        return {
            "seed_title": seed_title,
            "tmdb_id": tmdb_id,
            "title": data.get("title") or seed_title,
            "year": (data.get("release_date") or "")[:4],
            "genres": genres,
            "overview": data.get("overview") or "",
        }
    except Exception:
        return {"seed_title": seed_title}


def _build_google_query(seed_meta: dict, *, current_year: int | None = None) -> str:
    genres = seed_meta.get("genres") or []
    seed_title = seed_meta.get("title") or seed_meta.get("seed_title") or ""
    now_year = int(current_year or datetime.date.today().year)
    next_year = now_year + 1

    # Keep it simple and robust; favor “most anticipated upcoming” phrasing.
    if isinstance(genres, list) and genres:
        g = " ".join([str(x) for x in genres[:2] if x])
        return f"most anticipated upcoming {g} movies {now_year} {next_year}".strip()
    if seed_title:
        return f"most anticipated upcoming movies like {seed_title} {now_year} {next_year}".strip()
    return f"most anticipated upcoming movies {now_year} {next_year}".strip()


def get_recommendations(movie_name: str, *, plex=None, tmdb_cache=None, media_type: str = "movie") -> list[str]:
    config = load_config()

    if media_type != "movie":
        logger.info(f"media_type={media_type!r} not supported; using TMDb movie recommendations anyway")

    # TMDb metadata is used for query building and for OpenAI context.
    seed_meta = _tmdb_seed_metadata(config.tmdb.api_key, movie_name)

    openai_enabled = bool(getattr(config, "openai", None) and (config.openai.api_key or "").strip())
    google_enabled = bool(
        openai_enabled
        and getattr(config, "google", None)
        and (config.google.api_key or "").strip()
        and (config.google.search_engine_id or "").strip()
    )

    # 1) Optional Google search (only if OpenAI enabled)
    google_context = ""
    google_failed = False
    if google_enabled:
        local_year = datetime.date.today().year
        q = _build_google_query(seed_meta, current_year=local_year)
        logger.info(f"Google CSE enabled: query={q!r}")
        results, meta = google_custom_search_with_meta(
            api_key=config.google.api_key,
            search_engine_id=config.google.search_engine_id,
            query=q,
            num_results=config.google.num_results,
        )

        if meta.server_year is not None:
            logger.info(
                f"Google server Date header={meta.server_date!r} -> year={meta.server_year} (local_year={local_year})"
            )
            if meta.server_year != local_year:
                logger.warning(
                    f"Google response Date indicates year={meta.server_year} but local system year={local_year}; retrying search with Google year"
                )
                q2 = _build_google_query(seed_meta, current_year=meta.server_year)
                if q2 != q:
                    logger.info(f"Google CSE retry: query={q2!r}")
                    results2, meta2 = google_custom_search_with_meta(
                        api_key=config.google.api_key,
                        search_engine_id=config.google.search_engine_id,
                        query=q2,
                        num_results=config.google.num_results,
                    )
                    if results2:
                        results, meta = results2, meta2
                        q = q2

        if results:
            google_context = format_search_results_for_prompt(results)
            logger.info(f"Google CSE returned {len(results)} results; using web context for OpenAI")
        else:
            google_failed = True
            logger.warning("Google CSE returned no results or failed; proceeding with OpenAI without web context")

    # 2) OpenAI (optional)
    if openai_enabled:
        recs = get_related_movies(
            movie_name,
            api_key=config.openai.api_key,
            model=getattr(config.openai, "model", "gpt-5.2-chat-latest"),
            limit=config.recommendations.count,
            tmdb_seed_metadata=seed_meta,
            google_search_context=google_context or None,
        )
        cleaned = [r.split("(")[0].strip() for r in recs if r and r.strip()]
        if cleaned:
            logger.info(f"Using OpenAI recommendations returned={len(cleaned)}")
            return cleaned
        logger.warning("OpenAI enabled but returned empty; falling back to TMDb")
    elif not openai_enabled:
        logger.info("OpenAI disabled (missing/placeholder key); using TMDb fallback")

    if tmdb_cache is None:
        logger.error("tmdb_cache not provided; cannot score by vote_average")
        return []

    # 3) TMDb fallback (advanced) - mandatory
    try:
        tmdb_titles = get_tmdb_recommendations_advanced(
            api_key=config.tmdb.api_key,
            seed_title=movie_name,
            tmdb_cache=tmdb_cache,
            limit=config.recommendations.count,  # ✅ config-driven (overall)
            plex=plex,                            # ✅ filter out already-in-Plex
        )
    except Exception as e:
        logger.error(f"TMDb failed. TMDb API key is mandatory. Error: {type(e).__name__}: {e}")
        return []

    logger.info(f"Using TMDb recommendations returned={len(tmdb_titles)}")
    return tmdb_titles

