#!/usr/bin/env python3
"""
TV Immaculate Taste Collection (Episode trigger pipeline)

Usage:
    python3 tv_immaculate_taste_collection.py "Show - Episode Title" episode
    python3 tv_immaculate_taste_collection.py "Show Name" show
"""

import sys
import time
from pathlib import Path

from requests.exceptions import Timeout, ConnectionError as RequestsConnectionError
from urllib3.exceptions import ReadTimeoutError, ConnectTimeoutError

# Add project root to path for standalone execution
project_root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(project_root / "src"))

from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.pipeline_tv_immaculate import run_tv_pipeline

logger = setup_logger("tv_immaculate_taste_collection")


def main() -> int:
    script_start_time = time.time()

    if len(sys.argv) < 2:
        logger.error('Usage: python3 tv_immaculate_taste_collection.py "Show - Episode Title" episode')
        logger.info("FINAL_STATUS=FAILED FINAL_EXIT_CODE=30")
        return 30

    seed_title = sys.argv[1]
    media_type = (sys.argv[2] if len(sys.argv) > 2 else "episode").lower().strip()

    logger.info("=" * 60)
    logger.info("TV IMMACULATE TASTE COLLECTION SCRIPT START")
    logger.info("=" * 60)
    logger.info(f"Seed input: {seed_title}")
    logger.info(f"Media type: {media_type}")
    logger.info("")

    try:
        stats = run_tv_pipeline(seed_title, media_type) or {}

        exit_code = 0
        status = "SUCCESS"

        try:
            sonarr_failed = int((stats or {}).get("sonarr_failed", 0) or 0)
            search_failed = int((stats or {}).get("sonarr_search_failed", 0) or 0)
            if sonarr_failed > 0 or search_failed > 0:
                status = "PARTIAL"
                exit_code = 10
        except Exception:
            pass

        elapsed = time.time() - script_start_time
        logger.info("")
        logger.info("=" * 60)
        logger.info("TV IMMACULATE TASTE COLLECTION SCRIPT SUMMARY")
        logger.info("=" * 60)
        logger.info(f"recommendations={int((stats or {}).get('recs', 0) or 0)}")
        logger.info(
            f"plex_found={int((stats or {}).get('plex_found', 0) or 0)} plex_missing={int((stats or {}).get('plex_missing', 0) or 0)}"
        )
        logger.info(f"Total execution time: {elapsed:.1f} seconds")
        logger.info("=" * 60)

        logger.info(f"TV IMMACULATE TASTE COLLECTION SCRIPT END {status}")
        logger.info(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
        return exit_code

    except KeyboardInterrupt:
        logger.warning("\nScript interrupted by user")
        logger.info("TV IMMACULATE TASTE COLLECTION SCRIPT END (interrupted)")
        logger.info("FINAL_STATUS=INTERRUPTED FINAL_EXIT_CODE=130")
        return 130
    except Exception as e:
        dependency_failed = isinstance(e, (Timeout, RequestsConnectionError, ReadTimeoutError, ConnectTimeoutError))
        status = "DEPENDENCY_FAILED" if dependency_failed else "FAILED"
        exit_code = 20 if dependency_failed else 30
        logger.exception("TV IMMACULATE TASTE COLLECTION SCRIPT END FAIL")
        logger.error(f"Error: {type(e).__name__}: {e}")
        logger.error(f"FINAL_STATUS={status} FINAL_EXIT_CODE={exit_code}")
        return exit_code


if __name__ == "__main__":
    raise SystemExit(main())


