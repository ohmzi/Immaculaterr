import { fetchJson } from '@/api/http';

export type HealthResponse = {
  status: 'ok';
  time: string;
};

export function getHealth() {
  return fetchJson<HealthResponse>('/api/health');
}

