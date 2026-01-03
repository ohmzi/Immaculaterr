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

export async function createPlexPin(): Promise<PlexPinResponse> {
  return fetchJson('/api/plex/pin', { method: 'POST' });
}

export async function checkPlexPin(pinId: number): Promise<PlexPinCheckResponse> {
  return fetchJson(`/api/plex/pin/${pinId}`);
}
