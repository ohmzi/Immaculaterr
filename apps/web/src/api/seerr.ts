import { fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS } from '@/api/constants';

export type TestSeerrConnectionParams = {
  baseUrl: string;
  apiKey: string;
};

export type TestSeerrConnectionResponse = {
  ok: true;
  user: unknown;
};

export function testSeerrConnection(
  params: TestSeerrConnectionParams,
) {
  return fetchJson<TestSeerrConnectionResponse>(apiPath('/seerr/test'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
}

export async function resetSeerrRequests() {
  return await fetchJson<{
    ok: true;
    total: number;
    deleted: number;
    failed: number;
    failedRequestIds: number[];
  }>(apiPath('/seerr/requests/reset'), { method: 'DELETE' });
}
