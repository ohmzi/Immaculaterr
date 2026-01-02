import datetime
import math

from tautulli_curated.helpers.chatgpt_utils import get_related_tv_shows
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.tmdb_tv_recommender import get_tmdb_tv_recommendations_advanced
from tautulli_curated.helpers.tmdb_client import search_tv, get_tv
from tautulli_curated.helpers.google_search import google_custom_search_with_meta, format_search_results_for_prompt

logger = setup_logger("tv_recommender")


def _tmdb_seed_metadata_tv(api_key: str, seed_title: str) -> dict:
    """
    Best-effort TMDb TV lookup for prompt context.
    Returns a small dict (title, year, genres, overview).
    """
    try:
        results = search_tv(api_key, seed_title) or []
        if not results:
            return {"seed_title": seed_title}
        tmdb_id = int(results[0]["id"])
        data = get_tv(api_key, tmdb_id) or {}
        genres = [g.get("name") for g in (data.get("genres") or []) if isinstance(g, dict) and g.get("name")]
        return {
            "seed_title": seed_title,
            "tmdb_id": tmdb_id,
            "title": data.get("name") or seed_title,
            "year": (data.get("first_air_date") or "")[:4],
            "genres": genres,
            "overview": data.get("overview") or "",
        }
    except Exception:
        return {"seed_title": seed_title}


def _build_google_query_tv(seed_meta: dict, *, current_year: int | None = None) -> str:
    genres = seed_meta.get("genres") or []
    seed_title = seed_meta.get("title") or seed_meta.get("seed_title") or ""
    now_year = int(current_year or datetime.date.today().year)
    next_year = now_year + 1

    if isinstance(genres, list) and genres:
        g = " ".join([str(x) for x in genres[:2] if x])
        return f"most anticipated upcoming {g} tv shows {now_year} {next_year}".strip()
    if seed_title:
        return f"most anticipated upcoming tv shows like {seed_title} {now_year} {next_year}".strip()
    return f"most anticipated upcoming tv shows {now_year} {next_year}".strip()


def get_tv_recommendations(show_name: str, *, plex=None, media_type: str = "episode") -> list[str]:
    config = load_config()

    if media_type not in {"episode", "show"}:
        logger.info(f"media_type={media_type!r} not specifically supported; using TV recommendations anyway")

    seed_meta = _tmdb_seed_metadata_tv(config.tmdb.api_key, show_name)

    openai_enabled = bool(getattr(config, "openai", None) and (config.openai.api_key or "").strip())
    google_enabled = bool(
        openai_enabled
        and getattr(config, "google", None)
        and (config.google.api_key or "").strip()
        and (config.google.search_engine_id or "").strip()
    )

    # 1) Optional Google search (only if OpenAI enabled)
    google_context = ""
    if google_enabled:
        frac = float(getattr(config.recommendations, "web_context_fraction", 0.30) or 0.0)
        frac = max(0.0, min(1.0, frac))
        desired_google_results = int(math.ceil(config.recommendations.count * frac))

        local_year = datetime.date.today().year
        q = _build_google_query_tv(seed_meta, current_year=local_year)
        logger.info(f"Google CSE enabled (TV): query={q!r}")

        results, meta = ([], None)
        if desired_google_results > 0:
            results, meta = google_custom_search_with_meta(
                api_key=config.google.api_key,
                search_engine_id=config.google.search_engine_id,
                query=q,
                num_results=desired_google_results,
            )

        if meta and meta.server_year is not None and meta.server_year != local_year:
            logger.warning(
                f"Google response Date indicates year={meta.server_year} but local system year={local_year}; retrying search with Google year"
            )
            q2 = _build_google_query_tv(seed_meta, current_year=meta.server_year)
            if q2 != q and desired_google_results > 0:
                results2, meta2 = google_custom_search_with_meta(
                    api_key=config.google.api_key,
                    search_engine_id=config.google.search_engine_id,
                    query=q2,
                    num_results=desired_google_results,
                )
                if results2:
                    results, meta = results2, meta2

        if results:
            google_context = format_search_results_for_prompt(results)
            logger.info(f"Google CSE returned {len(results)} results; using web context for OpenAI (TV)")
        else:
            logger.warning("Google CSE returned no results or failed; proceeding with OpenAI without web context (TV)")

    # 2) OpenAI (optional)
    if openai_enabled:
        frac = float(getattr(config.recommendations, "web_context_fraction", 0.30) or 0.0)
        frac = max(0.0, min(1.0, frac))
        recs = get_related_tv_shows(
            show_name,
            api_key=config.openai.api_key,
            model=config.openai.model,
            limit=config.recommendations.count,
            tmdb_seed_metadata=seed_meta,
            google_search_context=google_context or None,
            upcoming_cap_fraction=frac,
        )
        cleaned = [r.split("(")[0].strip() for r in recs if r and r.strip()]
        if cleaned:
            logger.info(f"Using OpenAI TV recommendations returned={len(cleaned)}")
            return cleaned
        logger.warning("OpenAI enabled but returned empty (TV); falling back to TMDb")
    else:
        logger.info("OpenAI disabled (missing/placeholder key); using TMDb fallback (TV)")

    # 3) TMDb fallback (advanced) - mandatory
    try:
        tmdb_titles = get_tmdb_tv_recommendations_advanced(
            api_key=config.tmdb.api_key,
            seed_title=show_name,
            limit=config.recommendations.count,
        )
    except Exception as e:
        logger.error(f"TMDb TV failed. TMDb API key is mandatory. Error: {type(e).__name__}: {e}")
        return []

    logger.info(f"Using TMDb TV recommendations returned={len(tmdb_titles)}")
    return tmdb_titles


