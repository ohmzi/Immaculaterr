import { fetchJson } from '@/api/http';

export type IntegrationTestResponse = {
  ok: true;
  result?: unknown;
  summary?: unknown;
};

export function testSavedIntegration(integrationId: string) {
  return fetchJson<IntegrationTestResponse>(`/api/integrations/test/${integrationId}`, {
    method: 'POST',
  });
}


