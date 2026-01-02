from __future__ import annotations

import json
from pathlib import Path

from plexapi.server import PlexServer

from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.plex_search import find_plex_show, normalize as _normalize_title
from tautulli_curated.helpers.plex_tv_helpers import get_tvdb_id_from_plex_series
from tautulli_curated.helpers.retry_utils import retry_with_backoff
from tautulli_curated.helpers.run_context import RunContext
from tautulli_curated.helpers.tv_recommender import get_tv_recommendations

import tautulli_curated.helpers.sonarr_utils as sonarr_utils

logger = setup_logger("pipeline_tv_immaculate")


def _parse_show_name(seed_title: str, media_type: str) -> str:
    t = (seed_title or "").strip()
    mt = (media_type or "").strip().lower()
    if mt == "episode" and " - " in t:
        left = (t.split(" - ", 1)[0] or "").strip()
        return left or t
    return t


def _tv_points_key(title: str, tvdb_id: int | None) -> str:
    if tvdb_id:
        return f"tvdb:{int(tvdb_id)}"
    return f"title:{_normalize_title(title)}"


def _get_points(entry: object) -> int:
    if not isinstance(entry, dict):
        return 0
    try:
        return int(entry.get("points") or 0)
    except Exception:
        return 0


def _load_points(path: Path) -> dict:
    try:
        with open(str(path), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        logger.exception(f"Failed reading TV points file: {path}")
        return {}


def _save_points(path: Path, points_data: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(str(path), "w", encoding="utf-8") as f:
            json.dump(points_data, f, indent=2, ensure_ascii=False)
    except Exception:
        logger.exception(f"Failed writing TV points file: {path}")


def run_tv_pipeline(seed_title: str, media_type: str, ctx: RunContext | None = None) -> dict:
    """
    TV Immaculate Taste pipeline:
      - Parse show name from episode title
      - Generate show recommendations (Google/OpenAI optional; TMDb fallback)
      - Plex lookup (TV library)
      - Update recommendation_points_tv.json (includes shows not yet in Plex)
      - Optional Sonarr automation (config permission): add series + sync monitoring + targeted series search
    """
    ctx = ctx or RunContext()
    config = load_config()

    show_name = _parse_show_name(seed_title, media_type)
    if not show_name:
        logger.warning("TV pipeline: empty show name; skipping")
        return {"recs": 0, "plex_found": 0, "plex_missing": 0}

    stats: dict[str, int] = {
        "recs": 0,
        "plex_found": 0,
        "plex_missing": 0,
        "sonarr_added": 0,
        "sonarr_monitored": 0,
        "sonarr_failed": 0,
        "sonarr_search_queued": 0,
        "sonarr_search_failed": 0,
        "sonarr_episode_monitored": 0,
        "sonarr_episode_unmonitored": 0,
    }

    # Connect to Plex (required)
    def _connect_plex():
        return PlexServer(config.plex.url, config.plex.token, timeout=30)

    plex, _success = retry_with_backoff(
        _connect_plex,
        max_retries=3,
        logger_instance=logger,
        operation_name="Plex connection (TV)",
        raise_on_final_failure=True,
    )

    # --- Recommend
    with ctx.step(logger, "tv_recommend", show=show_name):
        recs = get_tv_recommendations(show_name, plex=plex, media_type=media_type) or []
    stats["recs"] = len(recs)

    # --- Plex lookup (TV library)
    plex_by_norm: dict[str, object] = {}
    missing_titles: list[str] = []
    with ctx.step(logger, "plex_tv_lookup", count=len(recs)):
        total = len(recs)
        for i, title in enumerate(recs, 1):
            series = find_plex_show(plex, title, library_name=config.plex.tv_library_name, logger=logger)
            if series:
                plex_by_norm[_normalize_title(title)] = series
            else:
                missing_titles.append(title)
            if i % 5 == 0 or i == total:
                logger.info(f"progress {i}/{total} found={len(plex_by_norm)} missing={len(missing_titles)}")

    stats["plex_found"] = len(plex_by_norm)
    stats["plex_missing"] = len(missing_titles)

    # Optional Sonarr automation
    auto_dl = bool(getattr(config, "sonarr", None) and getattr(config.sonarr, "auto_download_recommendations", False))
    sonarr_tvdb_by_norm: dict[str, int] = {}
    if auto_dl and recs:
        with ctx.step(logger, "sonarr_tv_auto_download", count=len(recs)):
            for title in recs:
                norm = _normalize_title(title)
                plex_series = plex_by_norm.get(norm)

                ok, series, action = sonarr_utils.sonarr_add_series(config, title, search=False)
                if not ok or not isinstance(series, dict):
                    stats["sonarr_failed"] += 1
                    continue

                try:
                    if action == "added":
                        stats["sonarr_added"] += 1
                    else:
                        stats["sonarr_monitored"] += 1
                except Exception:
                    pass

                series_id = int(series.get("id") or 0) if series.get("id") is not None else 0
                tvdb_id = int(series.get("tvdbId") or 0) if series.get("tvdbId") is not None else 0
                if tvdb_id:
                    sonarr_tvdb_by_norm[norm] = tvdb_id

                # If the series exists in Plex, sync episode monitoring (episodes in Plex unmonitored, missing monitored)
                if series_id and plex_series is not None:
                    sync_stats = sonarr_utils.sonarr_sync_episode_monitoring_with_plex(
                        config, series_id=series_id, plex_series=plex_series
                    ) or {}
                    try:
                        stats["sonarr_episode_monitored"] += int(sync_stats.get("monitored", 0) or 0)
                        stats["sonarr_episode_unmonitored"] += int(sync_stats.get("unmonitored", 0) or 0)
                    except Exception:
                        pass

                # Targeted series search (minimal load)
                if series_id:
                    if sonarr_utils.sonarr_series_search(config, series_id):
                        stats["sonarr_search_queued"] += 1
                    else:
                        stats["sonarr_search_failed"] += 1

    # --- Update TV points (includes shows not yet in Plex)
    points_path = config.base_dir / "data" / "recommendation_points_tv.json"
    points_data = _load_points(points_path)

    with ctx.step(logger, "tv_points_update", recs=len(recs)):
        # Build index of existing tvdb -> key (for key migration/merge)
        existing_tvdb_to_key: dict[int, str] = {}
        for k, v in list(points_data.items()):
            if not isinstance(v, dict):
                continue
            try:
                tid = int(v.get("tvdb_id") or 0)
            except Exception:
                tid = 0
            if tid:
                existing_tvdb_to_key[tid] = str(k)

        suggested_keys: set[str] = set()

        for title in recs:
            norm = _normalize_title(title)
            plex_series = plex_by_norm.get(norm)
            canonical_title = getattr(plex_series, "title", None) or title
            rating_key = str(getattr(plex_series, "ratingKey", "")) if plex_series is not None else ""

            tvdb_id = None
            if plex_series is not None:
                tvdb_id = get_tvdb_id_from_plex_series(plex_series)
            if tvdb_id is None:
                tvdb_id = sonarr_tvdb_by_norm.get(norm)

            key = _tv_points_key(canonical_title, tvdb_id)

            # If we previously stored this under a title-key but now know tvdb_id, migrate
            if tvdb_id:
                old_key = existing_tvdb_to_key.get(int(tvdb_id))
                if old_key and old_key != key and old_key in points_data and key not in points_data:
                    points_data[key] = points_data.pop(old_key)

            entry = points_data.get(key)
            if not isinstance(entry, dict):
                entry = {}

            entry["title"] = str(canonical_title)
            entry["points"] = 50
            if rating_key:
                entry["rating_key"] = rating_key
            if tvdb_id:
                entry["tvdb_id"] = int(tvdb_id)

            points_data[key] = entry
            suggested_keys.add(key)

        # Decay everything else by 1, remove at 0
        removed = 0
        decayed = 0
        for k in list(points_data.keys()):
            if k in suggested_keys:
                continue
            p = _get_points(points_data.get(k))
            p2 = p - 1
            if p2 <= 0:
                try:
                    del points_data[k]
                    removed += 1
                except Exception:
                    pass
            else:
                if isinstance(points_data.get(k), dict):
                    points_data[k]["points"] = int(p2)
                    decayed += 1

        logger.info(
            "tv_points_algo: suggested_now=%d decayed=%d removed=%d total=%d",
            len(suggested_keys),
            decayed,
            removed,
            len(points_data),
        )

    _save_points(points_path, points_data)
    logger.info(f"Saved TV points entries={len(points_data)} to {points_path}")

    logger.info("============ TV PIPELINE SUMMARY ============")
    logger.info(f"seed_input={seed_title!r} parsed_show={show_name!r}")
    logger.info(f"recommendations={stats['recs']}")
    logger.info(f"plex_found={stats['plex_found']} plex_missing={stats['plex_missing']}")
    if auto_dl:
        logger.info(
            "sonarr_added=%d sonarr_monitored=%d sonarr_failed=%d series_search_queued=%d series_search_failed=%d ep_monitored=%d ep_unmonitored=%d",
            stats["sonarr_added"],
            stats["sonarr_monitored"],
            stats["sonarr_failed"],
            stats["sonarr_search_queued"],
            stats["sonarr_search_failed"],
            stats["sonarr_episode_monitored"],
            stats["sonarr_episode_unmonitored"],
        )
    else:
        logger.info("sonarr_auto_download_recommendations=OFF")
    logger.info("============================================")

    return stats


