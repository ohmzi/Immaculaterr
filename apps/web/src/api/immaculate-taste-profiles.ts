import { apiPath, JSON_HEADERS } from '@/api/constants';
import { fetchJson } from '@/api/http';

export type ImmaculateTasteProfileMediaType = 'movie' | 'show' | 'both';
export type ImmaculateTasteProfileMatchMode = 'all' | 'any';

export type ImmaculateTasteProfileUserOverride = {
  plexUserId: string;
  mediaType: ImmaculateTasteProfileMediaType;
  matchMode: ImmaculateTasteProfileMatchMode;
  genres: string[];
  audioLanguages: string[];
  radarrInstanceId: string | null;
  sonarrInstanceId: string | null;
  movieCollectionBaseName: string | null;
  showCollectionBaseName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImmaculateTasteProfile = {
  id: string;
  datasetId: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  sortOrder: number;
  mediaType: ImmaculateTasteProfileMediaType;
  matchMode: ImmaculateTasteProfileMatchMode;
  genres: string[];
  audioLanguages: string[];
  radarrInstanceId: string | null;
  sonarrInstanceId: string | null;
  movieCollectionBaseName: string | null;
  showCollectionBaseName: string | null;
  userOverrides: ImmaculateTasteProfileUserOverride[];
  createdAt: string;
  updatedAt: string;
};

export function listImmaculateTasteProfiles() {
  return fetchJson<{ ok: true; profiles: ImmaculateTasteProfile[] }>(
    apiPath('/immaculate-taste-profiles'),
  );
}

export function createImmaculateTasteProfile(body: {
  name: string;
  enabled?: boolean;
  mediaType?: ImmaculateTasteProfileMediaType;
  matchMode?: ImmaculateTasteProfileMatchMode;
  genres?: string[];
  audioLanguages?: string[];
  radarrInstanceId?: string | null;
  sonarrInstanceId?: string | null;
  movieCollectionBaseName?: string | null;
  showCollectionBaseName?: string | null;
}) {
  return fetchJson<{ ok: true; profile: ImmaculateTasteProfile }>(
    apiPath('/immaculate-taste-profiles'),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
}

export function updateImmaculateTasteProfile(
  id: string,
  body: {
    name?: string;
    enabled?: boolean;
    scopePlexUserId?: string | null;
    resetScopeToDefaultNaming?: boolean;
    mediaType?: ImmaculateTasteProfileMediaType;
    matchMode?: ImmaculateTasteProfileMatchMode;
    genres?: string[];
    audioLanguages?: string[];
    radarrInstanceId?: string | null;
    sonarrInstanceId?: string | null;
    movieCollectionBaseName?: string | null;
    showCollectionBaseName?: string | null;
  },
) {
  return fetchJson<{ ok: true; profile: ImmaculateTasteProfile }>(
    apiPath(`/immaculate-taste-profiles/${encodeURIComponent(id)}`),
    {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
}

export function deleteImmaculateTasteProfile(id: string) {
  return fetchJson<{ ok: true }>(
    apiPath(`/immaculate-taste-profiles/${encodeURIComponent(id)}`),
    {
      method: 'DELETE',
    },
  );
}
