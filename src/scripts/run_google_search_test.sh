#!/bin/bash
#
# Google Custom Search (CSE) Test Runner
#
# Runs the exact same Google query generation + CSE request used by the pipeline,
# so you can debug Google 403/permission/quota issues independently.
#
# Usage:
#   ./run_google_search_test.sh "Movie Title" [media_type]
#
# Examples:
#   ./run_google_search_test.sh "The Lion King" movie
#   ./run_google_search_test.sh "Inception"
#

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

# Ensure HOME is set (cron-safe)
if [[ -z "${HOME:-}" ]] || [[ "$HOME" == "/root" ]]; then
  export HOME="/home/ohmz"
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"Movie Title\" [media_type]"
  exit 1
fi

MOVIE_TITLE="$1"
MEDIA_TYPE="${2:-movie}"

export PYTHONUNBUFFERED=1
export PYTHONUSERBASE="${HOME}/.local"
USER_SITE_PACKAGES=$(python3 -c "import site; print(site.getusersitepackages())" 2>/dev/null || echo "${HOME}/.local/lib/python3.12/site-packages")
export PYTHONPATH="${USER_SITE_PACKAGES}:$PROJECT_ROOT/src:${PYTHONPATH:-}"

python3 - "$MOVIE_TITLE" "$MEDIA_TYPE" <<'PY'
import json
import signal
import sys
from tautulli_curated.helpers.config_loader import load_config
from tautulli_curated.helpers.recommender import _tmdb_seed_metadata, _build_google_query
from tautulli_curated.helpers.google_search import google_custom_search_with_meta

# Avoid BrokenPipeError tracebacks when output is piped (e.g., to head/grep)
signal.signal(signal.SIGPIPE, signal.SIG_DFL)

cfg = load_config()
seed = sys.argv[1] if len(sys.argv) > 1 else ""
media_type = sys.argv[2] if len(sys.argv) > 2 else "movie"

print("============================================================")
print("GOOGLE CSE TEST")
print("============================================================")
print("seed_title:", seed)
print("media_type:", media_type)
print("google.api_key set:", bool((cfg.google.api_key or '').strip()))
print("google.search_engine_id set:", bool((cfg.google.search_engine_id or '').strip()))
print("")

seed_meta = _tmdb_seed_metadata(cfg.tmdb.api_key, seed)
query = _build_google_query(seed_meta)

print("TMDb seed metadata:")
print(json.dumps(seed_meta, indent=2, ensure_ascii=False))
print("")
print("Generated Google query:")
print(query)
print("")

frac = float(getattr(cfg.recommendations, "web_context_fraction", 0.30) or 0.0)
if frac < 0:
    frac = 0.0
if frac > 1:
    frac = 1.0
desired_google_results = int((cfg.recommendations.count * frac) + 0.999999)  # ceil without importing math
print(f"Google context sizing: total={cfg.recommendations.count} web_context_fraction={frac:.2f} -> num_results={desired_google_results}")
print("")

results, meta = google_custom_search_with_meta(
    api_key=cfg.google.api_key,
    search_engine_id=cfg.google.search_engine_id,
    query=query,
    num_results=desired_google_results,
)

if meta.server_year is not None:
    print(f"Google server Date header: {meta.server_date or '(missing)'}")
    print(f"Google server year: {meta.server_year}")

print(f"Results returned: {len(results)}")
for i, r in enumerate(results, 1):
    print("")
    print(f"{i}. {r.title}")
    print(f"   {r.snippet}")
    print(f"   {r.link}")
PY


