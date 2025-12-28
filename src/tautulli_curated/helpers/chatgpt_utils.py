import sys
from pathlib import Path

# Allow running this file directly (python3 chatgpt_utils.py)
if __name__ == "__main__":
    # Go up from helpers/ -> tautulli_curated/ -> src/ -> project root
    PROJECT_ROOT = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(PROJECT_ROOT / "src"))


import os
import re
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


def get_related_movies(
    movie_name: str,
    *,
    api_key: Optional[str] = None,
    model: str = "gpt-5.2",
    limit: int = 25,
) -> List[str]:
    """
    Return a list of related movie titles for a given watched movie.
    Uses OpenAI if available/configured; otherwise returns [].

    IMPORTANT: keep this function small + dependable; pipeline logging happens elsewhere.
    """
    api_key = api_key or os.getenv("OPENAI_API_KEY")
    if OpenAI is None:
        logger.error("OpenAI SDK not available (openai import failed).")
        return []

    if not api_key:
        logger.error("OPENAI_API_KEY not set; cannot fetch recommendations.")
        return []

    client = OpenAI(api_key=api_key)
    prompt = (
        f"Recommend {limit} movies similar in tone, themes, atmosphere, or cinematic style to '{movie_name}'. "
        "About 80% of the movies should already be released and about 20% should be upcoming or unreleased. "
        "Roughly 40–50% should be well-known or mainstream films, "
        "30–40% should be lesser-known indie or international films, "
        "and 10–20% should be niche, arthouse, or film-festival favorites "
        "(e.g., Cannes, Venice, Sundance, TIFF, Berlinale) that are highly regarded among film enthusiasts. "
        "Avoid low-effort or generic franchise entries unless they are genuinely relevant to the recommendation. "
        "Return ONLY a plain newline-separated list of movie titles (no extra text, no numbering). "
        "Do not include years unless necessary to disambiguate titles."
    )

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a movie recommendation engine."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
        )

        text = resp.choices[0].message.content or ""
        recs = parse_recommendations(text, limit=limit)

        logger.info(f"OpenAI returned {len(recs)} recommendations for '{movie_name}'")
        return recs

    except Exception:
        logger.exception("OpenAI call failed in get_related_movies()")
        return []
        

if __name__ == "__main__":
    from tautulli_curated.helpers.config_loader import load_config

    movie = sys.argv[1] if len(sys.argv) > 1 else "Inception"

    config = load_config()

    print(f"\nTesting OpenAI recommendations for: {movie}\n")

    recs = get_related_movies(
        movie,
        api_key=config.openai.api_key,               # ✅ pulled from config.yaml
        limit=config.openai.recommendation_count,
    )

    print(f"Returned {len(recs)} recommendations:\n")
    for i, r in enumerate(recs, 1):
        print(f"{i:02d}. {r}")

