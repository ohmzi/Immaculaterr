import { fetchJson } from '@/api/http';
import { apiPath } from '@/api/constants';

export async function resetOverseerrRequests() {
  return await fetchJson<{
    ok: true;
    total: number;
    deleted: number;
    failed: number;
    failedRequestIds: number[];
  }>(apiPath('/overseerr/requests/reset'), { method: 'DELETE' });
}
