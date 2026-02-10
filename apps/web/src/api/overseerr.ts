import { fetchJson } from '@/api/http';

export async function resetOverseerrRequests() {
  return await fetchJson<{
    ok: true;
    total: number;
    deleted: number;
    failed: number;
    failedRequestIds: number[];
  }>('/api/overseerr/requests/reset', { method: 'DELETE' });
}
