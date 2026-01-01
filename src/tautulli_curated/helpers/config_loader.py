# tautulli_curated/helpers/config_loader.py
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any, Dict, Optional

import yaml

from tautulli_curated.helpers.logger import setup_logger

logger = setup_logger("config_loader")

_PLACEHOLDER_X_RE = re.compile(r"x{8,}", re.IGNORECASE)


def _normalize_str(v: Any) -> str:
    return ("" if v is None else str(v)).strip()


def _is_disabled_key(value: Any, *, disabled_literals_upper: set[str]) -> bool:
    """
    Treat blank values and obvious placeholders as "disabled".

    Examples:
    - "GOOGLE_API_KEY"
    - "sk-proj-XXXXXXXXXXXXXXXXXXX"
    - any string containing 8+ consecutive 'X' characters
    """
    s = _normalize_str(value)
    if not s:
        return True
    if s.upper() in disabled_literals_upper:
        return True
    if _PLACEHOLDER_X_RE.search(s):
        return True
    return False


@dataclass(frozen=True)
class PlexConfig:
    url: str
    token: str
    movie_library_name: str
    tv_library_name: str
    collection_name: str
    delete_preference: str = "smallest_file"
    preserve_quality: list[str] = None
    randomize_collection: bool = True


@dataclass(frozen=True)
class OpenAIConfig:
    api_key: str = ""
    model: str = "gpt-5.2-chat-latest"


@dataclass(frozen=True)
class GoogleConfig:
    api_key: str = ""
    search_engine_id: str = ""  # Google Programmable Search Engine ID (cx)
    # Legacy: older configs may set google.num_results, but current logic derives
    # Google context sizing from recommendations.count * recommendations.web_context_fraction.
    num_results: int = 0


@dataclass(frozen=True)
class TMDbConfig:
    api_key: str


@dataclass(frozen=True)
class RecommendationsConfig:
    count: int = 50
    web_context_fraction: float = 0.30


@dataclass(frozen=True)
class RadarrConfig:
    url: str
    api_key: str
    root_folder: str
    tag_name: str | list[str]  # Can be a single tag (string) or multiple tags (list)
    quality_profile_id: int = 1


@dataclass(frozen=True)
class SonarrConfig:
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
    run_sonarr_duplicate_cleaner: bool = True
    run_radarr_monitor_confirm_plex: bool = True
    run_sonarr_monitor_confirm_plex: bool = True
    run_sonarr_search_monitored: bool = True
    run_collection_refresher: bool = True  # Immaculate Taste Collection Refresher (mandatory - adds movies to Plex)
    run_recently_watched_collection: bool = True  # Recently Watched Collection script
    run_immaculate_taste_collection: bool = True  # Immaculate Taste Collection script
    run_recently_watched_refresher: bool = True  # Recently Watched Collection Refresher (mandatory - adds movies to Plex)


@dataclass(frozen=True)
class AppConfig:
    base_dir: Path
    config_path: Path
    plex: PlexConfig
    openai: OpenAIConfig
    google: GoogleConfig
    recommendations: RecommendationsConfig
    tmdb: TMDbConfig
    radarr: RadarrConfig
    sonarr: SonarrConfig
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
    if config_path:
        cfg_path = Path(config_path)
    else:
        # Prefer a local-only config if present (safe for public repos)
        local_yaml = base_dir / "config" / "config.local.yaml"
        local_yml = base_dir / "config" / "config.local.yml"
        default_yaml = base_dir / "config" / "config.yaml"
        default_yml = base_dir / "config" / "config.yml"

        if local_yaml.exists():
            cfg_path = local_yaml
        elif local_yml.exists():
            cfg_path = local_yml
        elif default_yaml.exists():
            cfg_path = default_yaml
        else:
            cfg_path = default_yml

    if not cfg_path.exists():
        raise FileNotFoundError(
            f"Config not found. Expected one of: "
            f"{base_dir / 'config' / 'config.local.yaml'}, "
            f"{base_dir / 'config' / 'config.yaml'}"
        )

    data = yaml.safe_load(cfg_path.read_text()) or {}
    logger.info(f"Loaded config from {cfg_path}")

    plex = PlexConfig(
        url=_require(data, "plex.url"),
        token=_require(data, "plex.token"),
        movie_library_name=_require(data, "plex.movie_library_name"),
        tv_library_name=_require(data, "plex.tv_library_name"),
        collection_name=_require(data, "plex.collection_name"),
        delete_preference=data.get("plex", {}).get("delete_preference", "smallest_file"),
        preserve_quality=data.get("plex", {}).get("preserve_quality", []) or [],
        randomize_collection=bool(data.get("plex", {}).get("randomize_collection", True)),
    )

    # Overall recommendations count (used by OpenAI + TMDb)
    # Priority:
    #  1) recommendations.count (new)
    #  2) recommendation_count (legacy root key)
    #  3) openai.recommendation_count (legacy)
    #  4) tmdb.recommendation_count (legacy)
    recs_data = data.get("recommendations", {}) or {}
    openai_data = data.get("openai", {}) or {}
    tmdb_data = data.get("tmdb", {}) or {}

    raw_count = recs_data.get("count", None)
    if raw_count is None:
        raw_count = data.get("recommendation_count", None)
    if raw_count is None:
        raw_count = openai_data.get("recommendation_count", None)
    if raw_count is None:
        raw_count = tmdb_data.get("recommendation_count", None)

    try:
        overall_count = int(raw_count or 50)
    except Exception:
        overall_count = 50

    # How much "web context / upcoming-from-web" to bias toward.
    # 0.30 means up to ~30% of the final recommendation list can be sourced from web context.
    raw_web_frac = recs_data.get("web_context_fraction", recs_data.get("web_bias_fraction", 0.30))
    try:
        web_frac = float(raw_web_frac)
    except Exception:
        web_frac = 0.30
    # Clamp to sane range
    if web_frac < 0:
        web_frac = 0.0
    if web_frac > 1:
        web_frac = 1.0

    recommendations = RecommendationsConfig(count=overall_count, web_context_fraction=web_frac)

    # Optional: OpenAI (disabled if missing/placeholder)
    raw_openai_key = _normalize_str(openai_data.get("api_key", ""))
    openai_key = "" if _is_disabled_key(raw_openai_key, disabled_literals_upper={"OPENAI_API_KEY"}) else raw_openai_key
    openai_model = _normalize_str(openai_data.get("model", OpenAIConfig.model)) or OpenAIConfig.model

    openai = OpenAIConfig(
        api_key=openai_key,
        model=openai_model,
    )

    # Optional: Google Custom Search (only used when OpenAI is enabled)
    google_data = data.get("google", {}) or {}
    raw_google_key = _normalize_str(google_data.get("api_key", ""))
    google_key = "" if _is_disabled_key(raw_google_key, disabled_literals_upper={"GOOGLE_API_KEY"}) else raw_google_key
    raw_cx = _normalize_str(google_data.get("search_engine_id", google_data.get("cx", "")))
    cx = "" if _is_disabled_key(raw_cx, disabled_literals_upper={"GOOGLE_CSE_ID", "GOOGLE_SEARCH_ENGINE_ID", "CX"}) else raw_cx
    google = GoogleConfig(
        api_key=google_key,
        search_engine_id=cx,
        num_results=int(google_data.get("num_results", 5) or 5),
    )

    # TMDb is mandatory (fail fast if missing/placeholder)
    raw_tmdb_key = _normalize_str(tmdb_data.get("api_key", None))
    if _is_disabled_key(raw_tmdb_key, disabled_literals_upper={"TMDB_API_KEY"}):
        logger.error("TMDb API key is mandatory. Please set tmdb.api_key in config/config.yaml.")
        raise KeyError("Missing required config key: 'tmdb.api_key'")

    tmdb = TMDbConfig(
        api_key=raw_tmdb_key,
    )

    radarr = RadarrConfig(
        url=_require(data, "radarr.url"),
        api_key=_require(data, "radarr.api_key"),
        root_folder=_require(data, "radarr.root_folder"),
        tag_name=_require(data, "radarr.tag_name"),
        quality_profile_id=int(data.get("radarr", {}).get("quality_profile_id", 1)),
    )

    sonarr = SonarrConfig(
        url=_require(data, "sonarr.url"),
        api_key=_require(data, "sonarr.api_key"),
        root_folder=_require(data, "sonarr.root_folder"),
        tag_name=_require(data, "sonarr.tag_name"),
        quality_profile_id=int(data.get("sonarr", {}).get("quality_profile_id", 1)),
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
        run_sonarr_duplicate_cleaner=bool(data.get("scripts_run", {}).get("run_sonarr_duplicate_cleaner", True)),
        run_radarr_monitor_confirm_plex=bool(data.get("scripts_run", {}).get("run_radarr_monitor_confirm_plex", True)),
        run_sonarr_monitor_confirm_plex=bool(data.get("scripts_run", {}).get("run_sonarr_monitor_confirm_plex", True)),
        run_sonarr_search_monitored=bool(data.get("scripts_run", {}).get("run_sonarr_search_monitored", True)),
        run_collection_refresher=bool(data.get("scripts_run", {}).get("run_collection_refresher", True)),  # Default: True (mandatory)
        run_recently_watched_collection=bool(data.get("scripts_run", {}).get("run_recently_watched_collection", True)),
        run_immaculate_taste_collection=bool(data.get("scripts_run", {}).get("run_immaculate_taste_collection", True)),
        run_recently_watched_refresher=bool(data.get("scripts_run", {}).get("run_recently_watched_refresher", True)),  # Default: True (mandatory)
    )

    return AppConfig(
        base_dir=base_dir,
        config_path=cfg_path,
        plex=plex,
        openai=openai,
        google=google,
        recommendations=recommendations,
        tmdb=tmdb,
        radarr=radarr,
        sonarr=sonarr,
        files=files,
        scripts_run=scripts_run,
        raw=data,
    )

