import { fetchJson } from '@/api/http';
import { apiPath } from '@/api/constants';

export type AppMetaResponse = {
  name: string;
  version: string;
  buildSha: string | null;
  buildTime: string | null;
  publicBasePath: string;
};

export function getAppMeta() {
  return fetchJson<AppMetaResponse>(apiPath('/meta'));
}
