import { fetchJson } from '@/api/http';
import type {
  CredentialEnvelope,
  EnvelopeKeyResponse,
} from '@/lib/security/clientCredentialEnvelope';

export type PublicSettingsResponse = {
  settings: Record<string, unknown>;
  secretsPresent: Record<string, boolean>;
  secretRefs: Record<string, string>;
  meta: { dataDir: string | null };
};

export function getPublicSettings() {
  return fetchJson<PublicSettingsResponse>('/api/settings');
}

export function getSecretsEnvelopeKey() {
  return fetchJson<EnvelopeKeyResponse>('/api/settings/secrets-key');
}

export function putSettings(body: {
  settings?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  secretsEnvelope?: CredentialEnvelope;
}) {
  return fetchJson<PublicSettingsResponse>('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

