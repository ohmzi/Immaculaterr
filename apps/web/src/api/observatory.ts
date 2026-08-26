import { ApiError, fetchJson } from '@/api/http';
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

// ---------------------------------------------------------------------------
// Apply is asynchronous on the server: the POST starts a Plex collection
// rebuild and answers 202 with a handle, because holding the request open for
// the whole rebuild exceeded the origin timeout of any reverse proxy in front
// of the app. Polling the handle here keeps the old promise contract for
// callers — resolves when the sync lands, rejects with the server's reason
// when it does not.
// ---------------------------------------------------------------------------

type ApplyHandle = {
  applyId: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
};

// Poll quickly at first — most applies finish in seconds and the deck should
// settle promptly — then ease off, so a rebuild that runs for minutes is not
// worth ~50 requests a minute for its whole length.
const APPLY_POLL_MIN_INTERVAL_MS = 2_000;
const APPLY_POLL_MAX_INTERVAL_MS = 10_000;
const APPLY_POLL_BACKOFF_FACTOR = 1.4;
// Give up reporting after this long. The apply itself keeps running on the
// server — this only bounds how long the UI waits to hear about it.
const APPLY_POLL_TIMEOUT_MS = 10 * 60 * 1000;
// A blip while polling should not condemn an apply that is probably fine.
const APPLY_POLL_MAX_CONSECUTIVE_ERRORS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApply(
  basePath: `/${string}`,
  started: ApplyHandle,
): Promise<unknown> {
  const deadline = Date.now() + APPLY_POLL_TIMEOUT_MS;
  let current = started;
  let consecutiveErrors = 0;
  let intervalMs = APPLY_POLL_MIN_INTERVAL_MS;

  while (current.status === 'running') {
    if (Date.now() > deadline) {
      throw new Error(
        'Still syncing to Plex — this is taking longer than usual. The server is continuing in the background.',
      );
    }
    await sleep(intervalMs);
    intervalMs = Math.min(
      Math.round(intervalMs * APPLY_POLL_BACKOFF_FACTOR),
      APPLY_POLL_MAX_INTERVAL_MS,
    );
    try {
      current = await fetchJson<ApplyHandle>(
        apiPath(`${basePath}/${current.applyId}`),
      );
      consecutiveErrors = 0;
    } catch (err) {
      // The server forgot this apply — restarted, or the handle aged out.
      // Retrying cannot bring it back, so stop instead of polling a 404
      // until the deadline.
      if (err instanceof ApiError && err.status === 404) {
        throw new Error(
          'Lost track of the Plex sync — it may still have completed. Swipe again to retry.',
        );
      }
      consecutiveErrors += 1;
      if (consecutiveErrors >= APPLY_POLL_MAX_CONSECUTIVE_ERRORS) throw err;
    }
  }

  if (current.status === 'failed') {
    throw new Error(current.error || 'Apply failed');
  }
  return current.result;
}

export async function applyImmaculateTasteObservatory(params: {
  librarySectionKey: string;
  mediaType: 'movie' | 'tv';
}) {
  const started = await fetchJson<ApplyHandle>(
    apiPath('/observatory/immaculate-taste/apply'),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    },
  );
  return await waitForApply('/observatory/immaculate-taste/apply', started);
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
  const started = await fetchJson<ApplyHandle>(
    apiPath('/observatory/watched/apply'),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    },
  );
  return await waitForApply('/observatory/watched/apply', started);
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
