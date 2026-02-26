import { fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS } from '@/api/constants';
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
  return fetchJson<PublicSettingsResponse>(apiPath('/settings'));
}

export function getSecretsEnvelopeKey() {
  return fetchJson<EnvelopeKeyResponse>(apiPath('/settings/secrets-key'));
}

export function putSettings(body: {
  settings?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  secretsEnvelope?: CredentialEnvelope;
}) {
  return fetchJson<PublicSettingsResponse>(apiPath('/settings'), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}
