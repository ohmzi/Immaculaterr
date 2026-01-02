import { fetchJson } from '@/api/http';

export type PublicSettingsResponse = {
  settings: Record<string, unknown>;
  secretsPresent: Record<string, boolean>;
  meta: { dataDir: string | null };
};

export type ImportYamlPreviewResponse = {
  ok: true;
  applied: false;
  warnings: string[];
  preview: {
    settingsPatch: Record<string, unknown>;
    secretsPaths: string[];
  };
};

export type ImportYamlApplyResponse = {
  ok: true;
  applied: true;
  warnings: string[];
  result: PublicSettingsResponse;
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

export function importYamlPreview(yaml: string) {
  return fetchJson<ImportYamlPreviewResponse>('/api/settings/import-yaml', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml, mode: 'preview' }),
  });
}

export function importYamlApply(yaml: string) {
  return fetchJson<ImportYamlApplyResponse>('/api/settings/import-yaml', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml, mode: 'apply' }),
  });
}


