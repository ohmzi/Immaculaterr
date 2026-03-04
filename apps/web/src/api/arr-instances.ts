import { apiPath, JSON_HEADERS } from '@/api/constants';
import { fetchJson } from '@/api/http';
import type { CredentialEnvelope } from '@/lib/security/clientCredentialEnvelope';

export type ArrInstanceType = 'radarr' | 'sonarr';

export type ArrInstance = {
  id: string;
  type: ArrInstanceType;
  name: string;
  isPrimary: boolean;
  enabled: boolean;
  baseUrl: string;
  rootFolderPath: string | null;
  qualityProfileId: number | null;
  tagId: number | null;
  sortOrder: number;
  apiKeySet: boolean;
};

export type ArrInstancesResponse = {
  ok: true;
  instances: ArrInstance[];
};

export function listArrInstances(type?: ArrInstanceType) {
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  return fetchJson<ArrInstancesResponse>(apiPath(`/arr-instances${query}`));
}

export function createArrInstance(body: {
  type: ArrInstanceType;
  name?: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnvelope?: CredentialEnvelope;
  secretEnvelope?: CredentialEnvelope;
  secretRef?: string;
  enabled?: boolean;
}) {
  return fetchJson<{ ok: true; instance: ArrInstance }>(apiPath('/arr-instances'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function updateArrInstance(
  id: string,
  body: {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    apiKeyEnvelope?: CredentialEnvelope;
    secretEnvelope?: CredentialEnvelope;
    secretRef?: string;
    enabled?: boolean;
    rootFolderPath?: string | null;
    qualityProfileId?: number | null;
    tagId?: number | null;
    sortOrder?: number;
  },
) {
  return fetchJson<{ ok: true; instance: ArrInstance }>(
    apiPath(`/arr-instances/${encodeURIComponent(id)}`),
    {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
}

export function deleteArrInstance(id: string) {
  return fetchJson<{ ok: true }>(apiPath(`/arr-instances/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
}
