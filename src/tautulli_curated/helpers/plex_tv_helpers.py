from __future__ import annotations

import re
from typing import Optional, Set, Tuple


def get_tvdb_id_from_plex_series(series) -> Optional[int]:
    """
    Extract TVDB ID from Plex series GUIDs.

    Plex GUIDs often look like:
      - "tvdb://12345"
      - "com.plexapp.agents.thetvdb://12345?lang=en"
    """
    try:
        guids = getattr(series, "guids", []) or []
        for guid in guids:
            guid_id = getattr(guid, "id", "") or str(guid)
            if "tvdb" not in guid_id.lower():
                continue
            m = re.search(r"(\d+)", guid_id)
            if m:
                return int(m.group(1))
    except Exception:
        return None
    return None


def get_plex_episodes_set(plex_series) -> Set[Tuple[int, int]]:
    """
    Get a set of (seasonNumber, episodeNumber) tuples for all episodes present in Plex for a series.
    """
    episodes_set: Set[Tuple[int, int]] = set()
    try:
        episodes = plex_series.episodes()
        for episode in episodes:
            season = getattr(episode, "seasonNumber", None) or getattr(episode, "parentIndex", None)
            epnum = getattr(episode, "episodeNumber", None) or getattr(episode, "index", None)
            if season is None or epnum is None:
                continue
            episodes_set.add((int(season), int(epnum)))
    except Exception:
        return episodes_set
    return episodes_set


