from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Set

import requests

from tautulli_curated.helpers.logger import setup_logger

logger = setup_logger("tmdb_tv_recommender")


@dataclass(frozen=True)
class Candidate:
    tmdb_id: int
    title: str
    source: str  # "recommendations" | "similar" | "discover" | "trending"
    score: float


def _get_json(url: str, params: dict, timeout: int = 20) -> dict:
    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    return r.json() or {}


def _paged_results(
    url: str,
    params: dict,
    *,
    max_items: int,
    max_pages: int = 10,
) -> List[dict]:
    out: List[dict] = []
    page = 1

    while len(out) < max_items and page <= max_pages:
        data = _get_json(url, {**params, "page": page})
        results = data.get("results") or []
        if not results:
            break

        out.extend(results)

        total_pages = int(data.get("total_pages") or 1)
        if page >= total_pages:
            break

        page += 1

    return out[:max_items]


def _best_seed_result(query: str, results: list[dict]) -> Optional[dict]:
    q = (query or "").strip().lower()
    if not results:
        return None

    def score(r: dict) -> float:
        name = (r.get("name") or r.get("original_name") or "").strip().lower()
        pop = float(r.get("popularity") or 0.0)
        votes = float(r.get("vote_count") or 0.0)
        vavg = float(r.get("vote_average") or 0.0)

        starts = 80.0 if name.startswith(q) and q else 0.0
        contains = 30.0 if q and q in name else 0.0
        engagement = (votes * 0.04) + (pop * 0.5) + (vavg * 2.0)
        return starts + contains + engagement

    return max(results, key=score)


def _resolve_seed_tmdb_id(api_key: str, title: str) -> Optional[int]:
    data = _get_json(
        "https://api.themoviedb.org/3/search/tv",
        {"api_key": api_key, "query": title},
    )
    results = data.get("results") or []
    best = _best_seed_result(title, results)
    if not best:
        return None
    try:
        return int(best["id"])
    except Exception:
        return None


def _get_seed_genre_ids(api_key: str, tmdb_id: int) -> List[int]:
    data = _get_json(
        f"https://api.themoviedb.org/3/tv/{tmdb_id}",
        {"api_key": api_key},
    )
    genres = data.get("genres") or []
    out: List[int] = []
    for g in genres:
        try:
            out.append(int(g.get("id")))
        except Exception:
            pass
    return out


def _to_candidate(*, tmdb_id: int, title: str, source: str, vote_average: float, base_boost: float) -> Candidate:
    score = float(vote_average or 0.0) + float(base_boost or 0.0)
    return Candidate(tmdb_id=tmdb_id, title=title, source=source, score=score)


def get_tmdb_tv_recommendations_advanced(
    *,
    api_key: str,
    seed_title: str,
    limit: int = 50,
    allow_adult: bool = False,
) -> List[str]:
    """
    Advanced TMDb TV recommender:
      ✅ Merge /recommendations + /similar
      ✅ Genre-constrained /discover expansion if still short
      ✅ Blend in trending candidates when needed
      ✅ Rank by vote_average (+ small source boosts)
    """
    seed_tmdb_id = _resolve_seed_tmdb_id(api_key, seed_title)
    if not seed_tmdb_id:
        logger.warning(f"TMDb TV: could not resolve seed tmdb id for {seed_title!r}")
        return []

    logger.info("TMDb TV recommendation_count=%d seed=%r", limit, seed_title)

    seed_genres = set(_get_seed_genre_ids(api_key, seed_tmdb_id))
    logger.info("TMDb TV seed genres=%s", sorted(seed_genres))

    seen_ids: Set[int] = {seed_tmdb_id}
    candidates: Dict[int, Candidate] = {}

    def add_results(results: Iterable[dict], source: str, boost: float):
        for m in results:
            try:
                mid = int(m.get("id"))
            except Exception:
                continue

            if mid in seen_ids:
                continue

            title = (m.get("name") or m.get("original_name") or "").strip()
            if not title:
                continue

            vote_count = int(m.get("vote_count") or 0)
            if vote_count < 50:
                continue

            if seed_genres:
                g_ids = set(m.get("genre_ids") or [])
                if g_ids and not (seed_genres & g_ids):
                    continue

            vavg = float(m.get("vote_average") or 0.0)
            cand = _to_candidate(tmdb_id=mid, title=title, source=source, vote_average=vavg, base_boost=boost)

            existing = candidates.get(mid)
            if existing is None or cand.score > existing.score:
                candidates[mid] = cand

            seen_ids.add(mid)

    # 1) /recommendations
    rec_results = _paged_results(
        f"https://api.themoviedb.org/3/tv/{seed_tmdb_id}/recommendations",
        {"api_key": api_key, "include_adult": str(bool(allow_adult)).lower()},
        max_items=limit * 2,
        max_pages=5,
    )
    add_results(rec_results, "recommendations", boost=1.0)

    # 2) /similar
    sim_results = _paged_results(
        f"https://api.themoviedb.org/3/tv/{seed_tmdb_id}/similar",
        {"api_key": api_key, "include_adult": str(bool(allow_adult)).lower()},
        max_items=limit * 2,
        max_pages=5,
    )
    add_results(sim_results, "similar", boost=0.4)

    # 3) /discover expansion if still short
    if len(candidates) < limit and seed_genres:
        disc_results = _paged_results(
            "https://api.themoviedb.org/3/discover/tv",
            {
                "api_key": api_key,
                "include_adult": str(bool(allow_adult)).lower(),
                "with_genres": ",".join(map(str, list(seed_genres)[:3])),
                "vote_count.gte": 100,
                "sort_by": "vote_average.desc",
            },
            max_items=limit * 3,
            max_pages=10,
        )
        add_results(disc_results, "discover", boost=0.0)

    # 4) trending blend if still short
    if len(candidates) < limit:
        try:
            trending = _get_json(
                "https://api.themoviedb.org/3/trending/tv/week",
                {"api_key": api_key},
            ).get("results") or []
        except Exception:
            trending = []
        add_results(trending[: limit * 3], "trending", boost=-0.1)

    ranked = sorted(candidates.values(), key=lambda c: c.score, reverse=True)
    out = [c.title for c in ranked[:limit]]

    logger.info("TMDb TV advanced: seed=%r returned=%d candidates=%d", seed_title, len(out), len(candidates))
    return out


