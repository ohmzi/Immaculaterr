import type { paths } from '@/api/generated';

import { fetchJson } from '@/api/http';

export type HealthResponse = paths['/api/health']['get']['responses'][200]['content']['application/json'];

export function getHealth() {
  return fetchJson<HealthResponse>('/api/health');
}


