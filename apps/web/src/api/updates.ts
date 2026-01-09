import { fetchJson } from './http';

export type UpdatesResponse = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  source: 'github-releases';
  repo: string | null;
  latestUrl: string | null;
  checkedAt: string;
  error: string | null;
};

export function getUpdates() {
  return fetchJson<UpdatesResponse>('/api/updates');
}

