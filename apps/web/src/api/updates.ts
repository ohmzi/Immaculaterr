import { fetchJson } from '@/api/http';
import { apiPath } from '@/api/constants';

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
  return fetchJson<UpdatesResponse>(apiPath('/updates'));
}
