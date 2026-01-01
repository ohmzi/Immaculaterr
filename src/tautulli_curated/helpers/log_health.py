from __future__ import annotations

import json
import re
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional


_FILENAME_TS_RE = re.compile(r"^(?P<prefix>.+)_(?P<ymd>\d{8})_(?P<hms>\d{6})\.log$")
_FINAL_STATUS_RE = re.compile(r"\bFINAL_STATUS\s*=\s*(?P<status>[A-Z_]+)\b")
_FINAL_EXIT_RE = re.compile(r"\bFINAL_EXIT_CODE\s*=\s*(?P<code>\d+)\b")
_SCRIPT_EXIT_RE = re.compile(r"\bScript completed with exit code:\s*(?P<code>\d+)\b", re.IGNORECASE)
_WARN_EXIT_RE = re.compile(r"\bScript completed with warnings\b.*\bexit code:\s*(?P<code>\d+)\b", re.IGNORECASE)


def _now_local() -> datetime:
    # Use local time consistently with filename timestamps (which are local).
    return datetime.now()


def _parse_dt_from_filename(filename: str) -> Optional[datetime]:
    m = _FILENAME_TS_RE.match(filename)
    if not m:
        return None
    try:
        return datetime.strptime(m.group("ymd") + m.group("hms"), "%Y%m%d%H%M%S")
    except Exception:
        return None


def _script_name_from_filename(filename: str) -> str:
    m = _FILENAME_TS_RE.match(filename)
    if m:
        return m.group("prefix")
    # fallback: strip extension and keep best-effort prefix
    return filename.rsplit(".", 1)[0]


def _normalize_status(status: Optional[str], exit_code: Optional[int], text_flags: set[str]) -> str:
    """
    Return one of: SUCCESS | PARTIAL | FAIL | UNKNOWN
    """
    s = (status or "").strip().upper()
    if s:
        if "SUCCESS" in s or s in {"OK", "PASS", "PASSED"}:
            return "SUCCESS"
        if "PARTIAL" in s or "WARN" in s:
            return "PARTIAL"
        if "FAIL" in s or "ERROR" in s:
            return "FAIL"

    # Fallback heuristics
    if exit_code is not None:
        if exit_code == 0:
            # If the log explicitly contains failure markers, treat as fail anyway
            if "traceback" in text_flags or "fatal" in text_flags:
                return "FAIL"
            return "SUCCESS"
        # Many wrapper scripts use 10 for PARTIAL
        if exit_code == 10:
            return "PARTIAL"
        return "FAIL"

    if "end_ok" in text_flags:
        return "SUCCESS"
    if "end_fail" in text_flags or "traceback" in text_flags:
        return "FAIL"
    return "UNKNOWN"


def _severity_score(status: str, *, warnings: int, errors: int, exit_code: Optional[int]) -> int:
    """
    A simple 0..100 score to help rank "how bad" a failure was.
    0 = healthy, 100 = very bad.
    """
    base = {"SUCCESS": 0, "PARTIAL": 50, "FAIL": 90, "UNKNOWN": 60}.get(status, 60)
    # Errors matter more than warnings. Clamp.
    extra = min(20, errors * 5 + min(10, warnings))
    if exit_code not in (None, 0, 10):
        extra = min(25, extra + 5)
    return max(0, min(100, base + extra))


@dataclass(frozen=True)
class LogEvent:
    id: str
    path: str
    script_name: str
    timestamp: str
    status: str
    exit_code: Optional[int]
    warnings: int
    errors: int
    severity_score: int
    size_bytes: int
    issues: list[str]
    excerpt: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "path": self.path,
            "script_name": self.script_name,
            "timestamp": self.timestamp,
            "status": self.status,
            "exit_code": self.exit_code,
            "warnings": self.warnings,
            "errors": self.errors,
            "severity_score": self.severity_score,
            "size_bytes": self.size_bytes,
            "issues": self.issues,
            "excerpt": self.excerpt,
        }


def parse_log_file(log_path: Path, *, base_dir: Optional[Path] = None) -> LogEvent:
    filename = log_path.name
    dt = _parse_dt_from_filename(filename)
    if dt is None:
        try:
            dt = datetime.fromtimestamp(log_path.stat().st_mtime)
        except Exception:
            dt = _now_local()

    rel = str(log_path)
    if base_dir:
        try:
            rel = str(log_path.relative_to(base_dir))
        except Exception:
            rel = str(log_path)

    script_name = _script_name_from_filename(filename)

    final_status: Optional[str] = None
    final_exit_code: Optional[int] = None
    warnings = 0
    errors = 0
    text_flags: set[str] = set()

    tail = deque(maxlen=120)
    last_issue_lines = deque(maxlen=50)
    issues: set[str] = set()

    try:
        with log_path.open("r", encoding="utf-8", errors="replace") as f:
            for raw in f:
                line = raw.rstrip("\n")
                tail.append(line)

                u = line.upper()
                # Conservative counters
                if "WARNING" in u:
                    warnings += 1
                if "ERROR" in u:
                    errors += 1

                if "TRACEBACK" in u:
                    text_flags.add("traceback")
                if "END OK" in u or "END_OK" in u:
                    text_flags.add("end_ok")
                if "END FAIL" in u or "END_FAIL" in u or "END WITH ERRORS" in u:
                    text_flags.add("end_fail")

                if "401" in u and "UNAUTHORIZED" in u:
                    issues.add("Unauthorized (401) detected (check Plex token / API auth).")
                if "GOOGLE CSE" in u and ("FAILED" in u or "HTTP 403" in u):
                    issues.add("Google CSE failures detected (check API enablement/quota/key restrictions).")
                if "OPENAI" in u and "FAILED" in u:
                    issues.add("OpenAI failures detected (check API key / model availability).")

                m = _FINAL_STATUS_RE.search(u)
                if m:
                    final_status = m.group("status")

                m = _FINAL_EXIT_RE.search(u)
                if m:
                    try:
                        final_exit_code = int(m.group("code"))
                    except Exception:
                        pass

                if final_exit_code is None:
                    m = _SCRIPT_EXIT_RE.search(line)
                    if m:
                        try:
                            final_exit_code = int(m.group("code"))
                        except Exception:
                            pass

                if final_exit_code is None:
                    m = _WARN_EXIT_RE.search(line)
                    if m:
                        try:
                            final_exit_code = int(m.group("code"))
                        except Exception:
                            pass

                # Keep a small set of relevant lines for the excerpt
                if any(k in u for k in ("ERROR", "WARNING", "TRACEBACK", "EXCEPTION", "UNAUTHORIZED", "FINAL_STATUS", "FINAL_EXIT_CODE")):
                    last_issue_lines.append(line)
    except FileNotFoundError:
        # Treat missing file as UNKNOWN
        pass

    status = _normalize_status(final_status, final_exit_code, text_flags)
    sev = _severity_score(status, warnings=warnings, errors=errors, exit_code=final_exit_code)

    # Excerpt: prefer issue lines; fallback to tail
    excerpt_lines = list(last_issue_lines)[-25:] if last_issue_lines else list(tail)[-25:]

    try:
        size = int(log_path.stat().st_size)
    except Exception:
        size = 0

    return LogEvent(
        id=filename,
        path=rel,
        script_name=script_name,
        timestamp=dt.isoformat(timespec="seconds"),
        status=status,
        exit_code=final_exit_code,
        warnings=warnings,
        errors=errors,
        severity_score=sev,
        size_bytes=size,
        issues=sorted(issues),
        excerpt=excerpt_lines,
    )


def collect_log_events(
    *,
    logs_dir: Path,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    base_dir: Optional[Path] = None,
) -> list[LogEvent]:
    since = since or (_now_local() - timedelta(days=7))
    until = until or _now_local()

    out: list[LogEvent] = []
    if not logs_dir.exists():
        return out

    for p in sorted(logs_dir.glob("*.log")):
        dt = _parse_dt_from_filename(p.name) or datetime.fromtimestamp(p.stat().st_mtime)
        if dt < since or dt > until:
            continue
        out.append(parse_log_file(p, base_dir=base_dir))

    # newest first
    out.sort(key=lambda e: e.timestamp, reverse=True)
    return out


def summarize_events(
    events: list[LogEvent],
    *,
    always_include_scripts: Optional[set[str]] = None,
) -> dict[str, Any]:
    counts = Counter([e.status for e in events])
    per_script: dict[str, Any] = {}
    by_script: dict[str, list[LogEvent]] = defaultdict(list)
    for e in events:
        by_script[e.script_name].append(e)

    for script, items in sorted(by_script.items(), key=lambda kv: kv[0]):
        c = Counter([x.status for x in items])
        worst = max((x.severity_score for x in items), default=0)
        last = max(items, key=lambda x: x.timestamp)
        per_script[script] = {
            "runs": len(items),
            "success": c.get("SUCCESS", 0),
            "partial": c.get("PARTIAL", 0),
            "fail": c.get("FAIL", 0),
            "unknown": c.get("UNKNOWN", 0),
            "worst_severity_score": worst,
            "last": last.to_dict(),
        }

    # Ensure scripts appear even if they had no runs in this window (useful for cron dashboards).
    for script in sorted(always_include_scripts or []):
        if script in per_script:
            continue
        per_script[script] = {
            "runs": 0,
            "success": 0,
            "partial": 0,
            "fail": 0,
            "unknown": 0,
            "worst_severity_score": 0,
            "last": {"script_name": script, "status": "NO_RUNS", "timestamp": ""},
        }

    return {
        "window": {
            "runs": len(events),
            "success": counts.get("SUCCESS", 0),
            "partial": counts.get("PARTIAL", 0),
            "fail": counts.get("FAIL", 0),
            "unknown": counts.get("UNKNOWN", 0),
        },
        "per_script": per_script,
    }


def load_health_index(index_path: Path) -> dict[str, Any]:
    try:
        return json.loads(index_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def upsert_health_index(index_path: Path, events: list[LogEvent]) -> dict[str, Any]:
    data = load_health_index(index_path)
    if not isinstance(data, dict):
        data = {}
    for e in events:
        data[e.id] = e.to_dict()
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return data


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_window_payload(
    *,
    events: list[LogEvent],
    since: datetime,
    until: datetime,
    always_include_scripts: Optional[set[str]] = None,
) -> dict[str, Any]:
    daily: dict[str, Counter] = defaultdict(Counter)
    for e in events:
        day = (e.timestamp.split("T", 1)[0]) if e.timestamp else "unknown"
        daily[day][e.status] += 1
        daily[day]["runs"] += 1

    daily_out = {
        day: {
            "runs": c.get("runs", 0),
            "success": c.get("SUCCESS", 0),
            "partial": c.get("PARTIAL", 0),
            "fail": c.get("FAIL", 0),
            "unknown": c.get("UNKNOWN", 0),
        }
        for day, c in sorted(daily.items(), key=lambda kv: kv[0])
    }

    problems = [e for e in events if e.status in {"PARTIAL", "FAIL", "UNKNOWN"}]
    problems.sort(key=lambda e: (e.severity_score, e.timestamp), reverse=True)

    return {
        "generated_at": _now_local().isoformat(timespec="seconds"),
        "since": since.isoformat(timespec="seconds"),
        "until": until.isoformat(timespec="seconds"),
        "summary": summarize_events(events, always_include_scripts=always_include_scripts),
        "daily": daily_out,
        "events": [e.to_dict() for e in events],
        "problem_events": [e.to_dict() for e in problems],
    }


def write_health_outputs(
    *,
    logs_dir: Path,
    out_dir: Path,
    base_dir: Optional[Path] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    always_include_scripts: Optional[set[str]] = None,
) -> dict[str, Path]:
    since = since or (_now_local() - timedelta(days=7))
    until = until or _now_local()

    events = collect_log_events(logs_dir=logs_dir, since=since, until=until, base_dir=base_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Upsert index keyed by filename (good for dashboard lookups)
    index_path = out_dir / "health_index.json"
    upsert_health_index(index_path, events)

    latest_path = out_dir / "latest.json"
    latest_payload = build_window_payload(
        events=events, since=since, until=until, always_include_scripts=always_include_scripts
    )
    write_json(latest_path, latest_payload)

    weekly_path = out_dir / f"weekly_summary_{until.strftime('%Y%m%d')}.json"
    write_json(weekly_path, latest_payload)

    return {"health_index": index_path, "latest": latest_path, "weekly": weekly_path}


