import { fetchJson } from '@/api/http';
import { apiPath } from '@/api/constants';

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
  month: string; // YYYY-MM or YYYY-MM-DD (UTC)
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

export type PlexLibraryGrowthVersionResponse = {
  ok: true;
  version: string;
};

export function createPlexPin(): Promise<PlexPinResponse> {
  return fetchJson(apiPath('/plex/pin'), { method: 'POST' });
}

export function checkPlexPin(pinId: number): Promise<PlexPinCheckResponse> {
  return fetchJson(apiPath(`/plex/pin/${pinId}`));
}

export function getPlexLibraryGrowth(): Promise<PlexLibraryGrowthResponse> {
  return fetchJson(apiPath('/plex/library-growth'));
}

export async function getPlexLibraryGrowthVersion(): Promise<PlexLibraryGrowthVersionResponse> {
  return fetchJson(apiPath('/plex/library-growth/version'));
}
