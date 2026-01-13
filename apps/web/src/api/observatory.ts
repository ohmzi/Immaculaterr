import { fetchJson } from '@/api/http';

export type ObservatoryListMode = 'pendingApproval' | 'review';

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

export async function listImmaculateTasteMovieObservatory(params: {
  librarySectionKey: string;
  mode: ObservatoryListMode;
}) {
  const q = new URLSearchParams({
    librarySectionKey: params.librarySectionKey,
    mode: params.mode,
  });
  return await fetchJson<ListObservatoryResponse>(
    `/api/observatory/immaculate-taste/movies?${q.toString()}`,
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
    `/api/observatory/immaculate-taste/tv?${q.toString()}`,
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
    '/api/observatory/immaculate-taste/decisions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    },
  );
}

export async function applyImmaculateTasteObservatory(params: {
  librarySectionKey: string;
  mediaType: 'movie' | 'tv';
}) {
  return await fetchJson<{ ok: true }>(
    '/api/observatory/immaculate-taste/apply',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    },
  );
}

