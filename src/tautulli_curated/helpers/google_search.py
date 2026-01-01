from __future__ import annotations

from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import List, Optional, Tuple

import requests
from requests.exceptions import HTTPError

from tautulli_curated.helpers.logger import setup_logger

logger = setup_logger("google_search")


@dataclass(frozen=True)
class GoogleSearchResult:
    title: str
    snippet: str
    link: str


@dataclass(frozen=True)
class GoogleSearchMeta:
    server_date: str = ""
    server_year: Optional[int] = None


def _server_year_from_date_header(date_header: str) -> Optional[int]:
    """
    Extract year from an HTTP Date header (RFC 7231-ish).
    Example: "Wed, 31 Dec 2025 14:06:44 GMT"
    """
    if not date_header:
        return None
    try:
        dt = parsedate_to_datetime(date_header)
        return dt.year if dt else None
    except Exception:
        return None


def google_custom_search(
    *,
    api_key: str,
    search_engine_id: str,
    query: str,
    num_results: int = 5,
    timeout: int = 15,
) -> List[GoogleSearchResult]:
    results, _meta = google_custom_search_with_meta(
        api_key=api_key,
        search_engine_id=search_engine_id,
        query=query,
        num_results=num_results,
        timeout=timeout,
    )
    return results


def google_custom_search_with_meta(
    *,
    api_key: str,
    search_engine_id: str,
    query: str,
    num_results: int = 5,
    timeout: int = 15,
) -> Tuple[List[GoogleSearchResult], GoogleSearchMeta]:
    """
    Google Programmable Search (Custom Search JSON API).

    Endpoint: https://www.googleapis.com/customsearch/v1
    Required params: key, cx, q
    """
    api_key = (api_key or "").strip()
    search_engine_id = (search_engine_id or "").strip()
    query = (query or "").strip()

    if not api_key or not search_engine_id or not query:
        return [], GoogleSearchMeta()

    url = "https://www.googleapis.com/customsearch/v1"

    # Google CSE constraints: num ∈ [1, 10] per request; use pagination via start=1,11,21...
    try:
        wanted = int(num_results or 5)
    except Exception:
        wanted = 5
    if wanted < 0:
        wanted = 0

    out: List[GoogleSearchResult] = []
    seen_links: set[str] = set()
    meta = GoogleSearchMeta()

    # Nothing requested
    if wanted == 0:
        return [], meta

    start = 1
    # Safety cap (avoid huge loops)
    hard_cap = min(wanted, 50)

    while len(out) < hard_cap:
        remaining = hard_cap - len(out)
        page_size = max(1, min(remaining, 10))

        params = {
            "key": api_key,
            "cx": search_engine_id,
            "q": query,
            "num": page_size,
            "start": start,
        }

        try:
            r = requests.get(url, params=params, timeout=timeout)
            try:
                r.raise_for_status()
            except HTTPError:
                # Try to surface Google's structured error (very helpful for 403s)
                detail = ""
                try:
                    payload = r.json() or {}
                    err = payload.get("error") if isinstance(payload, dict) else None
                    if isinstance(err, dict):
                        msg = err.get("message")
                        reason = None
                        errors = err.get("errors") or []
                        if isinstance(errors, list) and errors:
                            first = errors[0] if isinstance(errors[0], dict) else {}
                            reason = first.get("reason")
                        detail = f" message={msg!r} reason={reason!r}"
                except Exception:
                    body = (r.text or "").strip().replace("\n", " ")
                    detail = f" body={body[:300]!r}"

                logger.warning(
                    "Google CSE request failed (non-fatal): HTTP %s%s (check API enabled/billing/key restrictions/cx)",
                    getattr(r, "status_code", "?"),
                    detail,
                )
                break

            if not meta.server_date:
                date_header = (r.headers or {}).get("Date", "") if hasattr(r, "headers") else ""
                meta = GoogleSearchMeta(
                    server_date=(date_header or "").strip(),
                    server_year=_server_year_from_date_header((date_header or "").strip()),
                )

            data = r.json() or {}
            items = data.get("items") or []
        except Exception as e:
            logger.warning(f"Google CSE request failed (non-fatal): {type(e).__name__}: {e}")
            break

        if not items:
            break

        added_this_page = 0
        for it in items:
            try:
                title = (it.get("title") or "").strip()
                snippet = (it.get("snippet") or "").strip()
                link = (it.get("link") or "").strip()
                if not title and not snippet:
                    continue
                if not link:
                    continue
                if link in seen_links:
                    continue
                seen_links.add(link)
                out.append(GoogleSearchResult(title=title, snippet=snippet, link=link))
                added_this_page += 1
                if len(out) >= hard_cap:
                    break
            except Exception:
                continue

        if added_this_page == 0:
            break

        # Next page starts after this page's start index
        start += page_size

        # Google API start index has limits; stop before it becomes invalid
        if start > 91:
            break

    return out, meta


def format_search_results_for_prompt(results: List[GoogleSearchResult], max_chars: int = 3000) -> str:
    """
    Compact a list of search results into a prompt-friendly block.
    """
    if not results:
        return ""

    lines: List[str] = []
    for i, r in enumerate(results, 1):
        block = f"{i}. {r.title}\n   {r.snippet}\n   {r.link}"
        lines.append(block)

    text = "\n".join(lines).strip()
    if len(text) <= max_chars:
        return text

    # truncate conservatively without breaking encoding
    return text[: max_chars - 20].rstrip() + "\n... (truncated)"


