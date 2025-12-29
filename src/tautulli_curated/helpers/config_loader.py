# tautulli_curated/helpers/config_loader.py
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import yaml

from tautulli_curated.helpers.logger import setup_logger

logger = setup_logger("config_loader")


@dataclass(frozen=True)
class PlexConfig:
    url: str
    token: str
    movie_library_name: str
    collection_name: str
    delete_preference: str = "smallest_file"
    preserve_quality: list[str] = None
    randomize_collection: bool = True


@dataclass(frozen=True)
class OpenAIConfig:
    api_key: str
    model: str = "gpt-5.2"
    recommendation_count: int = 50


@dataclass(frozen=True)
class TMDbConfig:
    api_key: str
    recommendation_count: int = 50  # ✅ NEW


@dataclass(frozen=True)
class RadarrConfig:
    url: str
    api_key: str
    root_folder: str
    tag_name: str | list[str]  # Can be a single tag (string) or multiple tags (list)
    quality_profile_id: int = 1


@dataclass(frozen=True)
class FilesConfig:
    points_file: str = "recommendation_points.json"
    tmdb_cache_file: str = "tmdb_cache.json"


@dataclass(frozen=True)
class ScriptsRunConfig:
    run_plex_duplicate_cleaner: bool = True
    run_radarr_monitor_confirm_plex: bool = True
    run_collection_refresher: bool = True  # Immaculate Taste Collection Refresher (mandatory - adds movies to Plex)
    run_recently_watched_collection: bool = True  # Recently Watched Collection script
    run_immaculate_taste_collection: bool = True  # Immaculate Taste Collection script
    run_recently_watched_refresher: bool = True  # Recently Watched Collection Refresher (mandatory - adds movies to Plex)


@dataclass(frozen=True)
class AppConfig:
    base_dir: Path
    plex: PlexConfig
    openai: OpenAIConfig
    tmdb: TMDbConfig
    radarr: RadarrConfig
    files: FilesConfig
    scripts_run: ScriptsRunConfig
    raw: Dict[str, Any]


def _require(d: Dict[str, Any], path: str) -> Any:
    cur: Any = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            raise KeyError(f"Missing required config key: '{path}'")
        cur = cur[part]
    return cur


def load_config(config_path: Optional[str] = None) -> AppConfig:
    """
    Loads config.yaml from the project config/ directory by default.
    """
    # Go up from helpers/ -> tautulli_curated/ -> src/ -> project root
    base_dir = Path(__file__).resolve().parents[3]
    cfg_path = Path(config_path) if config_path else (base_dir / "config" / "config.yaml")

    if not cfg_path.exists():
        raise FileNotFoundError(f"config.yaml not found at: {cfg_path}")

    data = yaml.safe_load(cfg_path.read_text()) or {}
    logger.info(f"Loaded config from {cfg_path}")

    plex = PlexConfig(
        url=_require(data, "plex.url"),
        token=_require(data, "plex.token"),
        movie_library_name=_require(data, "plex.movie_library_name"),
        collection_name=_require(data, "plex.collection_name"),
        delete_preference=data.get("plex", {}).get("delete_preference", "smallest_file"),
        preserve_quality=data.get("plex", {}).get("preserve_quality", []) or [],
        randomize_collection=bool(data.get("plex", {}).get("randomize_collection", True)),
    )

    openai = OpenAIConfig(
        api_key=_require(data, "openai.api_key"),
        model=data.get("openai", {}).get("model", "gpt-5.2"),
        recommendation_count=int(data.get("openai", {}).get("recommendation_count", 50)),
    )

    tmdb = TMDbConfig(
        api_key=_require(data, "tmdb.api_key"),
        recommendation_count=int(data.get("tmdb", {}).get("recommendation_count", 50)),  # ✅ NEW
    )

    radarr = RadarrConfig(
        url=_require(data, "radarr.url"),
        api_key=_require(data, "radarr.api_key"),
        root_folder=_require(data, "radarr.root_folder"),
        tag_name=_require(data, "radarr.tag_name"),
        quality_profile_id=int(data.get("radarr", {}).get("quality_profile_id", 1)),
    )

    # Data files are now in data/ directory, but config may still reference just filenames
    # We'll resolve them relative to data/ directory
    points_file_name = data.get("files", {}).get("points_file", "recommendation_points.json")
    tmdb_cache_file_name = data.get("files", {}).get("tmdb_cache_file", "tmdb_cache.json")
    
    # If paths are relative, assume they're in data/ directory
    if not Path(points_file_name).is_absolute():
        points_file_name = str(base_dir / "data" / points_file_name)
    if not Path(tmdb_cache_file_name).is_absolute():
        tmdb_cache_file_name = str(base_dir / "data" / tmdb_cache_file_name)
    
    files = FilesConfig(
        points_file=points_file_name,
        tmdb_cache_file=tmdb_cache_file_name,
    )

    scripts_run = ScriptsRunConfig(
        run_plex_duplicate_cleaner=bool(data.get("scripts_run", {}).get("run_plex_duplicate_cleaner", True)),
        run_radarr_monitor_confirm_plex=bool(data.get("scripts_run", {}).get("run_radarr_monitor_confirm_plex", True)),
        run_collection_refresher=bool(data.get("scripts_run", {}).get("run_collection_refresher", True)),  # Default: True (mandatory)
        run_recently_watched_collection=bool(data.get("scripts_run", {}).get("run_recently_watched_collection", True)),
        run_immaculate_taste_collection=bool(data.get("scripts_run", {}).get("run_immaculate_taste_collection", True)),
        run_recently_watched_refresher=bool(data.get("scripts_run", {}).get("run_recently_watched_refresher", True)),  # Default: True (mandatory)
    )

    return AppConfig(
        base_dir=base_dir,
        plex=plex,
        openai=openai,
        tmdb=tmdb,
        radarr=radarr,
        files=files,
        scripts_run=scripts_run,
        raw=data,
    )

