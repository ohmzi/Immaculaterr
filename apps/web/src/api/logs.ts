import { fetchJson } from '@/api/http';

export type ServerLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ServerLogEntry = {
  id: number;
  time: string;
  level: ServerLogLevel;
  message: string;
  context?: string | null;
};

export function listServerLogs(params?: { afterId?: number; limit?: number }) {
  const q = new URLSearchParams();
  if (params?.afterId !== undefined) q.set('afterId', String(params.afterId));
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return fetchJson<{ ok: true; logs: ServerLogEntry[]; latestId: number }>(`/api/logs${suffix}`);
}

export function clearServerLogs() {
  return fetchJson<{ ok: true }>('/api/logs', { method: 'DELETE' });
}


