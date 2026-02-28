import { fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS } from '@/api/constants';

export type ObservatoryListMode = 'pendingApproval' | 'review';
export type WatchedCollectionKind = 'recentlyWatched' | 'changeOfTaste';

export type ObservatoryItem = {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string | null;
  status: 'pending' | 'active';
  points: number;
  tmdbVoteAvg?: number | null;
  downloadApproval: 'none' | 'pending' | 'approved' | 'rejected';
  posterUrl: string | null;
  sentToRadarrAt?: string | null;
  sentToSonarrAt?: string | null;
  tmdbId?: number | null; // tv only (optional)
};

export type ListObservatoryResponse = {
  ok: true;
  mode: ObservatoryListMode;
  approvalRequiredFromObservatory: boolean;
  items: ObservatoryItem[];
};

export type ListWatchedObservatoryResponse = ListObservatoryResponse & {
  collectionKind: WatchedCollectionKind;
};

export async function listImmaculateTasteMovieObservatory(params: {
  librarySectionKey: string;
  mode: ObservatoryListMode;
}) {
  const q = new URLSearchParams({
    librarySectionKey: params.librarySectionKey,
    mode: params.mode,
  });
  return await fetchJson<ListObservatoryResponse>(
    apiPath(`/observatory/immaculate-taste/movies?${q.toString()}`),
  );
}

export async function listImmaculateTasteTvObservatory(params: {
  librarySectionKey: string;
  mode: ObservatoryListMode;
}) {
  const q = new URLSearchParams({
    librarySectionKey: params.librarySectionKey,
    mode: params.mode,
  });
  return await fetchJson<ListObservatoryResponse>(
    apiPath(`/observatory/immaculate-taste/tv?${q.toString()}`),
  );
}

export async function recordImmaculateTasteDecisions(params: {
  librarySectionKey: string;
  mediaType: 'movie' | 'tv';
  decisions: Array<{
    id: number;
    action: 'approve' | 'reject' | 'keep' | 'remove' | 'undo';
  }>;
}) {
  return await fetchJson<{ ok: true; applied: number; ignored: number }>(
    apiPath('/observatory/immaculate-taste/decisions'),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    },
  );
}

export async function applyImmaculateTasteObservatory(params: {
  librarySectionKey: string;
  mediaType: 'movie' | 'tv';
}) {
  return await fetchJson<{ ok: true }>(
    apiPath('/observatory/immaculate-taste/apply'),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    },
  );
}

export async function listWatchedMovieObservatory(params: {
  librarySectionKey: string;
  mode: ObservatoryListMode;
  collectionKind: WatchedCollectionKind;
}) {
  const q = new URLSearchParams({
    librarySectionKey: params.librarySectionKey,
    mode: params.mode,
    collectionKind: params.collectionKind,
  });
  return await fetchJson<ListWatchedObservatoryResponse>(
    apiPath(`/observatory/watched/movies?${q.toString()}`),
  );
}

export async function listWatchedTvObservatory(params: {
  librarySectionKey: string;
  mode: ObservatoryListMode;
  collectionKind: WatchedCollectionKind;
}) {
  const q = new URLSearchParams({
    librarySectionKey: params.librarySectionKey,
    mode: params.mode,
    collectionKind: params.collectionKind,
  });
  return await fetchJson<ListWatchedObservatoryResponse>(
    apiPath(`/observatory/watched/tv?${q.toString()}`),
  );
}

export async function recordWatchedDecisions(params: {
  librarySectionKey: string;
  mediaType: 'movie' | 'tv';
  collectionKind: WatchedCollectionKind;
  decisions: Array<{
    id: number;
    action: 'approve' | 'reject' | 'keep' | 'remove' | 'undo';
  }>;
}) {
  return await fetchJson<{ ok: true; applied: number; ignored: number }>(
    apiPath('/observatory/watched/decisions'),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    },
  );
}

export async function applyWatchedObservatory(params: {
  librarySectionKey: string;
  mediaType: 'movie' | 'tv';
}) {
  return await fetchJson<{
    ok: true;
    approvalRequired: boolean;
    unmonitored: number;
    sent: number;
  }>(apiPath('/observatory/watched/apply'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
}

export async function resetRejectedSuggestions() {
  return await fetchJson<{ ok: true; deleted: number }>(
    apiPath('/observatory/immaculate-taste/rejected/reset'),
    { method: 'DELETE' },
  );
}

export type RejectedSuggestionItem = {
  id: string;
  mediaType: 'movie' | 'tv';
  externalSource: 'tmdb' | 'tvdb';
  externalId: string;
  externalName: string | null;
  source: 'immaculate' | 'watched';
  collectionKind: 'immaculateTaste' | 'recentlyWatched' | 'changeOfTaste';
  reason: 'reject' | 'remove';
  createdAt: string;
};

export async function listRejectedSuggestions() {
  return await fetchJson<{
    ok: true;
    items: RejectedSuggestionItem[];
    total: number;
  }>(apiPath('/observatory/immaculate-taste/rejected'));
}

export async function deleteRejectedSuggestion(id: string) {
  return await fetchJson<{ ok: boolean; deleted?: number; error?: string }>(
    apiPath(`/observatory/immaculate-taste/rejected/${encodeURIComponent(id)}`),
    { method: 'DELETE' },
  );
}
