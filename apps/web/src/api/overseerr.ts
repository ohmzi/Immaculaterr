import { fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS } from '@/api/constants';

export type TestOverseerrConnectionParams = {
  baseUrl: string;
  apiKey: string;
};

export type TestOverseerrConnectionResponse = {
  ok: true;
  user: unknown;
};

export function testOverseerrConnection(
  params: TestOverseerrConnectionParams,
) {
  return fetchJson<TestOverseerrConnectionResponse>(apiPath('/overseerr/test'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
}

export async function resetOverseerrRequests() {
  return await fetchJson<{
    ok: true;
    total: number;
    deleted: number;
    failed: number;
    failedRequestIds: number[];
  }>(apiPath('/overseerr/requests/reset'), { method: 'DELETE' });
}
