#!/usr/bin/env python3
"""
TV Immaculate Taste Collection Refresher

Reads data/recommendation_points_tv.json and applies the corresponding shows to a Plex collection.

Usage:
    python3 tv_immaculate_taste_refresher.py [--dry-run] [--verbose]
"""

import sys
import json
import random
import argparse
import logging
import time
from pathlib import Path

from requests.exceptions import Timeout, ConnectionError as RequestsConnectionError
from urllib3.exceptions import ReadTimeoutError, ConnectTimeoutError

# Add project root to path for standalone execution
project_root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(project_root / "src"))

from plexapi.server import PlexServer
from plexapi.exceptions import NotFound

from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.plex_collection_manager import apply_collection_state_to_plex, _fetch_by_rating_key
from tautulli_curated.helpers.plex_search import normalize as _norm
from tautulli_curated.helpers.plex_tv_helpers import get_tvdb_id_from_plex_series

logger = setup_logger("tv_immaculate_taste_refresher")


def _load_points(path: Path) -> dict:
    try:
        with open(str(path), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        logger.warning(f"TV points file not found: {path}")
        return {}
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in TV points file {path}: {e}")
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
        logger.warning("Failed to persist updated TV points file (non-fatal)", exc_info=True)


def _points_value(entry: object) -> int:
    if not isinstance(entry, dict):
        return 0
    try:
        return int(entry.get("points") or 0)
    except Exception:
        return 0


def _pick_show_from_search_results(results: list, *, title: str, tvdb_id: int | None) -> object | None:
    # Prefer exact title match, and optionally exact tvdb match.
    if not results:
        return None

    norm_target = _norm(title or "")

    exact: list = []
    for r in results:
        try:
            if getattr(r, "type", "").lower() != "show":
                continue
            if _norm(getattr(r, "title", "") or "") == norm_target:
                exact.append(r)
        except Exception:
            continue

    show_results = [r for r in results if getattr(r, "type", "").lower() == "show"]
    if not show_results:
        return None

    # If we have TVDB id, try to confirm it — but never "guess" by taking the first fuzzy result.
    if tvdb_id:
        # 1) Exact title + tvdb match
        for r in exact:
            try:
                if get_tvdb_id_from_plex_series(r) == int(tvdb_id):
                    return r
            except Exception:
                continue
        # 2) Exact title match (tvdb may be unavailable in Plex metadata)
        if exact:
            return exact[0]
        # 3) Any tvdb match within results
        for r in show_results:
            try:
                if get_tvdb_id_from_plex_series(r) == int(tvdb_id):
                    return r
            except Exception:
                continue
        return None

    # No tvdb id: require exact title match to avoid false positives.
    return exact[0] if exact else None


def parse_args():
    p = argparse.ArgumentParser(description="TV Immaculate Taste Collection Refresher")
    p.add_argument("--dry-run", action="store_true", help="Show what would be done without updating Plex")
    p.add_argument("--verbose", "-v", action="store_true", help="Enable debug logging")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if args.verbose:
        logger.setLevel(logging.DEBUG)

    logger.info("=" * 60)
    logger.info("TV IMMACULATE TASTE COLLECTION REFRESHER START")
    logger.info("=" * 60)
    if args.dry_run:
        logger.warning("DRY RUN MODE - No changes will be made to Plex")

    try:
        logger.info("Step 1: Loading configuration...")
        config = load_config()
        logger.info(f"  ✓ Config loaded from: {config.config_path}")
        logger.info(f"  ✓ Plex URL: {config.plex.url}")
        logger.info(f"  ✓ Library: {config.plex.tv_library_name}")
        logger.info(f"  ✓ Collection: {config.plex.tv_collection_name}")

        points_path = config.base_dir / "data" / "recommendation_points_tv.json"
        logger.info("Step 2: Loading TV points data...")
        logger.info(f"  Points file: {points_path}")
        points_data = _load_points(points_path)

        if not points_data:
            logger.warning("No TV points data found. Nothing to do.")
            logger.info("TV IMMACULATE TASTE COLLECTION REFRESHER END (no points)")
            logger.info("FINAL_STATUS=SKIPPED FINAL_EXIT_CODE=0")
            return 0

        # Connect to Plex
        logger.info("Step 3: Connecting to Plex...")
        plex = PlexServer(config.plex.url, config.plex.token, timeout=30)
        logger.info(f"  ✓ Connected to Plex server: {plex.friendlyName}")

        section = plex.library.section(config.plex.tv_library_name)

        # Resolve points entries to Plex show items
        logger.info("Step 4: Resolving shows from points file against Plex...")
        resolved_items: list = []
        missing_entries: list[str] = []

        # Iterate in deterministic order, then randomize at the end
        keys = list(points_data.keys())
        updated_points = False

        for k in keys:
            entry = points_data.get(k)
            if _points_value(entry) <= 0:
                continue
            if not isinstance(entry, dict):
                continue

            title = str(entry.get("title") or "").strip()
            if not title and str(k).startswith("title:"):
                title = str(k).split("title:", 1)[1].strip()
            if not title:
                continue

            tvdb_id = None
            try:
                if entry.get("tvdb_id") is not None:
                    tvdb_id = int(entry.get("tvdb_id") or 0) or None
            except Exception:
                tvdb_id = None

            # Prefer rating_key if present
            rk = str(entry.get("rating_key") or "").strip()
            item = None
            if rk:
                item = _fetch_by_rating_key(section, rk)
                if item and getattr(item, "type", "").lower() != "show":
                    item = None

            if not item:
                # Fallback: title search
                try:
                    results = section.search(title=title)
                except Exception:
                    results = []
                item = _pick_show_from_search_results(results, title=title, tvdb_id=tvdb_id)

            if not item:
                missing_entries.append(title)
                continue

            # Update entry with rating_key + tvdb_id if possible
            try:
                new_rk = str(getattr(item, "ratingKey", "")) or ""
                if new_rk and entry.get("rating_key") != new_rk:
                    entry["rating_key"] = new_rk
                    updated_points = True
                plex_tvdb = get_tvdb_id_from_plex_series(item)
                if plex_tvdb and entry.get("tvdb_id") != plex_tvdb:
                    entry["tvdb_id"] = int(plex_tvdb)
                    updated_points = True
                if getattr(item, "title", None) and entry.get("title") != item.title:
                    entry["title"] = str(item.title)
                    updated_points = True
            except Exception:
                pass

            points_data[k] = entry
            resolved_items.append(item)

        if updated_points:
            _save_points(points_path, points_data)
            logger.info("  ✓ Updated TV points file with newly discovered rating_key/tvdb_id metadata")

        if not resolved_items:
            logger.warning("No valid TV shows found in Plex from points file. Nothing to do.")
            logger.info("TV IMMACULATE TASTE COLLECTION REFRESHER END (no valid items)")
            logger.info("FINAL_STATUS=SKIPPED FINAL_EXIT_CODE=0")
            return 0

        logger.info(f"  ✓ Found {len(resolved_items)} shows in Plex")
        if missing_entries:
            logger.info(f"  ⚠ {len(missing_entries)} shows from points file not found in Plex yet (skipped)")

        # Randomize ordering each run
        logger.info("Step 5: Randomizing order...")
        random.shuffle(resolved_items)

        collection_state = {
            "rating_keys": [str(getattr(i, "ratingKey", "")) for i in resolved_items if getattr(i, "ratingKey", None)],
            "items": [{"rating_key": str(getattr(i, "ratingKey", "")), "title": getattr(i, "title", "")} for i in resolved_items],
        }

        if args.dry_run:
            logger.info("Step 6: DRY RUN - Would apply TV collection state to Plex...")
            status = "SUCCESS"
            exit_code = 0
        else:
            logger.info("Step 6: Applying TV collection state to Plex...")
            stats = apply_collection_state_to_plex(
                plex=plex,
                library_name=config.plex.tv_library_name,
                collection_name=config.plex.tv_collection_name,
                collection_state=collection_state,
                logger=logger,
                base_dir=config.base_dir,
                allowed_types={"show"},
                hub_pin_order=[config.plex.tv_collection_name],
            )
            logger.debug(f"apply_collection stats={stats}")

            # Determine final status + exit code
            status = "SUCCESS"
            exit_code = 0
            order_failed = 0
            try:
                order_failed = int((stats.get("order_stats") or {}).get("failed", 0) or 0)
            except Exception:
                order_failed = 0

            # Missing entries are expected (recommended shows may not be in Plex yet).
            # Only mark PARTIAL if the actual Plex update/reorder had issues.
            if order_failed:
                status = "PARTIAL"
                exit_code = 10

        logger.info("=" * 60)
        logger.info(f"TV IMMACULATE TASTE COLLECTION REFRESHER END {status}")
        logger.info(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
        logger.info("=" * 60)
        return exit_code

    except KeyboardInterrupt:
        logger.warning("\nInterrupted by user")
        logger.info("TV IMMACULATE TASTE COLLECTION REFRESHER END (interrupted)")
        logger.info("FINAL_STATUS=INTERRUPTED FINAL_EXIT_CODE=130")
        return 130
    except Exception as e:
        dependency_failed = isinstance(e, (Timeout, RequestsConnectionError, ReadTimeoutError, ConnectTimeoutError))
        status = "DEPENDENCY_FAILED" if dependency_failed else "FAILED"
        exit_code = 20 if dependency_failed else 30
        logger.exception("TV IMMACULATE TASTE COLLECTION REFRESHER END FAIL")
        logger.error(f"Error: {type(e).__name__}: {e}")
        logger.error(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
        return exit_code


if __name__ == "__main__":
    raise SystemExit(main())


