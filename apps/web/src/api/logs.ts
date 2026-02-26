import { fetchJson } from '@/api/http';
import { apiPath, toQuerySuffix } from '@/api/constants';

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
  return fetchJson<{ ok: true; logs: ServerLogEntry[]; latestId: number }>(
    apiPath(`/logs${toQuerySuffix(q)}`),
  );
}

export function clearServerLogs() {
  return fetchJson<{ ok: true }>(apiPath('/logs'), { method: 'DELETE' });
}

