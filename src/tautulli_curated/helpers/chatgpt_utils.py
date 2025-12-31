import sys
from pathlib import Path

# Allow running this file directly (python3 chatgpt_utils.py)
if __name__ == "__main__":
    # Go up from helpers/ -> tautulli_curated/ -> src/ -> project root
    PROJECT_ROOT = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(PROJECT_ROOT / "src"))


import os
import re
import json
from typing import List, Optional

from tautulli_curated.helpers.logger import setup_logger

logger = setup_logger("chatgpt_utils")

# Optional: OpenAI support
try:
    from openai import OpenAI
except Exception:
    OpenAI = None  # type: ignore


def _clean_title(line: str) -> Optional[str]:
    """
    Normalize list output like:
      "1. Inception (2010)"
      "- The Prestige"
      "Interstellar — 2014"
    Return the best-guess title string.
    """
    s = line.strip()
    if not s:
        return None

    # remove bullet/numbering
    s = re.sub(r"^\s*[\-\*\u2022]\s*", "", s)          # bullets
    s = re.sub(r"^\s*\d+[\.\)]\s*", "", s)            # "1." or "1)"

    # remove trailing year patterns
    s = re.sub(r"\(\s*\d{4}\s*\)\s*$", "", s)          # "(2010)"
    s = re.sub(r"\s*[-–—]\s*\d{4}\s*$", "", s)         # " - 2010"

    # remove surrounding quotes
    s = s.strip().strip('"').strip("'").strip()

    return s if s else None


def parse_recommendations(text: str, limit: int = 50) -> List[str]:
    """
    Parse model text into a list of movie titles.
    """
    lines = re.split(r"[\r\n]+", text)
    out: List[str] = []
    seen = set()

    for line in lines:
        title = _clean_title(line)
        if not title:
            continue
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(title)
        if len(out) >= limit:
            break

    return out


def _try_parse_json_recs(text: str) -> tuple[list[str], list[str]]:
    """
    Attempt to parse a JSON response of the form:
      {"primary_recommendations": [...], "upcoming_from_search": [...]}
    Returns (primary, upcoming). Falls back to ([], []) on failure.
    """
    if not text:
        return [], []
    t = text.strip()

    # Common model behavior: wrap JSON in ```json fences
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", t).strip()
        t = re.sub(r"\s*```$", "", t).strip()

    try:
        obj = json.loads(t)
    except Exception:
        return [], []

    if not isinstance(obj, dict):
        return [], []

    primary = obj.get("primary_recommendations") or []
    upcoming = obj.get("upcoming_from_search") or []

    def _clean_list(v) -> list[str]:
        if not isinstance(v, list):
            return []
        out: list[str] = []
        seen = set()
        for item in v:
            if not isinstance(item, str):
                continue
            title = _clean_title(item) or ""
            if not title:
                continue
            key = title.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(title)
        return out

    return _clean_list(primary), _clean_list(upcoming)


def _merge_primary_and_upcoming(
    primary: list[str],
    upcoming: list[str],
    *,
    limit: int,
    upcoming_cap_fraction: float = 0.5,
) -> list[str]:
    """
    Merge lists with a cap on the number of upcoming titles (default: up to 50%).
    """
    if limit <= 0:
        return []

    cap = int(limit * upcoming_cap_fraction)
    cap = max(0, min(cap, limit))

    out: list[str] = []
    seen = set()

    def add(t: str):
        key = t.lower()
        if not t or key in seen:
            return
        seen.add(key)
        out.append(t)

    # First add upcoming titles not already in primary (up to cap)
    for t in upcoming:
        if len([x for x in out if x]) >= cap:
            break
        add(t)

    # Fill remainder with primary
    for t in primary:
        if len(out) >= limit:
            break
        add(t)

    # If still short (e.g. primary empty), backfill with more upcoming
    if len(out) < limit:
        for t in upcoming:
            if len(out) >= limit:
                break
            add(t)

    return out[:limit]


def get_related_movies(
    movie_name: str,
    *,
    api_key: Optional[str] = None,
    model: str = "gpt-5.2-chat-latest",
    limit: int = 25,
    tmdb_seed_metadata: Optional[dict] = None,
    google_search_context: Optional[str] = None,
) -> List[str]:
    """
    Return a list of related movie titles for a given watched movie.
    Uses OpenAI if available/configured; otherwise returns [].

    IMPORTANT: keep this function small + dependable; pipeline logging happens elsewhere.
    """
    api_key = api_key or os.getenv("OPENAI_API_KEY")
    if OpenAI is None:
        logger.warning("OpenAI SDK not available (openai import failed).")
        return []

    if not api_key:
        logger.info("OpenAI disabled (missing API key); skipping OpenAI recommendations.")
        return []

    client = OpenAI(api_key=api_key)

    seed_block = ""
    if isinstance(tmdb_seed_metadata, dict) and tmdb_seed_metadata:
        try:
            seed_block = json.dumps(tmdb_seed_metadata, ensure_ascii=False)
        except Exception:
            seed_block = ""

    web_block = (google_search_context or "").strip()

    prompt = (
        f"You are a movie recommendation engine.\n\n"
        f"Seed title: {movie_name}\n"
        f"Desired count: {limit}\n\n"
        f"TMDb seed metadata (JSON):\n{seed_block or '{}'}\n\n"
        f"Web search snippets (may include upcoming releases):\n{web_block or '(none)'}\n\n"
        "Return STRICT JSON only (no markdown, no prose) with this schema:\n"
        "{\n"
        '  \"primary_recommendations\": [\"Title 1\", \"Title 2\", ...],\n'
        '  \"upcoming_from_search\": [\"Upcoming Title A\", \"Upcoming Title B\", ...]\n'
        "}\n\n"
        "Rules:\n"
        "- primary_recommendations should be mostly released movies similar in tone/themes/style to the seed.\n"
        "- upcoming_from_search should include upcoming/unreleased movies that are relevant, preferably found in the web snippets.\n"
        "- Avoid duplicates across both lists.\n"
        "- Movie titles only (no years unless needed to disambiguate).\n"
    )

    try:
        # Note: some newer chat-latest models only support the default temperature.
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a movie recommendation engine."},
                {"role": "user", "content": prompt},
            ],
        )

        text = resp.choices[0].message.content or ""
        primary, upcoming = _try_parse_json_recs(text)
        if primary or upcoming:
            recs = _merge_primary_and_upcoming(primary, upcoming, limit=limit, upcoming_cap_fraction=0.5)
        else:
            # fallback: accept plain newline list
            recs = parse_recommendations(text, limit=limit)

        logger.info(f"OpenAI returned {len(recs)} recommendations for '{movie_name}'")
        return recs

    except Exception as e:
        logger.warning(f"OpenAI call failed (non-fatal): {type(e).__name__}: {e}")
        return []
        

if __name__ == "__main__":
    from tautulli_curated.helpers.config_loader import load_config

    movie = sys.argv[1] if len(sys.argv) > 1 else "Inception"

    config = load_config()

    print(f"\nTesting OpenAI recommendations for: {movie}\n")

    recs = get_related_movies(
        movie,
        api_key=config.openai.api_key,               # ✅ pulled from config.yaml
        limit=config.recommendations.count,
    )

    print(f"Returned {len(recs)} recommendations:\n")
    for i, r in enumerate(recs, 1):
        print(f"{i:02d}. {r}")

