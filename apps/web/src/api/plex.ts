import { fetchJson } from '@/api/http';

export type PlexPinResponse = {
  id: number;
  authUrl: string;
  expiresAt: string | null;
  clientIdentifier: string;
};

export type PlexPinCheckResponse = {
  id: number;
  authToken: string | null;
  expiresAt: string | null;
};

export type PlexLibraryGrowthPoint = {
  month: string; // YYYY-MM (UTC)
  movies: number;
  tv: number;
};

export type PlexLibraryGrowthResponse = {
  ok: true;
  series: PlexLibraryGrowthPoint[];
  summary: {
    startMonth: string | null;
    endMonth: string | null;
    movies: number;
    tv: number;
    total: number;
  };
};

export async function createPlexPin(): Promise<PlexPinResponse> {
  return fetchJson('/api/plex/pin', { method: 'POST' });
}

export async function checkPlexPin(pinId: number): Promise<PlexPinCheckResponse> {
  return fetchJson(`/api/plex/pin/${pinId}`);
}

export async function getPlexLibraryGrowth(): Promise<PlexLibraryGrowthResponse> {
  return fetchJson('/api/plex/library-growth');
}
