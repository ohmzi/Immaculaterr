import { fetchJson } from '@/api/http';

export type PublicSettingsResponse = {
  settings: Record<string, unknown>;
  secretsPresent: Record<string, boolean>;
  meta: { dataDir: string | null };
};

export function getPublicSettings() {
  return fetchJson<PublicSettingsResponse>('/api/settings');
}

export function putSettings(body: {
  settings?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
}) {
  return fetchJson<PublicSettingsResponse>('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}


