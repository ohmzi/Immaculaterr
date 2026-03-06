import { apiPath, JSON_HEADERS } from '@/api/constants';
import { ApiError, fetchJson, readApiError } from '@/api/http';

export type CollectionArtworkTarget = {
  mediaType: 'movie' | 'tv';
  targetKind: 'immaculate_profile' | 'watched_collection';
  targetId: string;
  source: 'immaculate' | 'watched';
  collectionBaseName: string;
  collectionName: string;
  datasetRows: number;
  hasCustomPoster: boolean;
  customPosterUpdatedAt: string | null;
};

export type CollectionArtworkManagedCollectionsResponse = {
  plexUser: {
    id: string;
    plexAccountTitle: string;
    isAdmin: boolean;
  };
  collections: CollectionArtworkTarget[];
};

export type UploadCollectionArtworkOverrideResponse = {
  ok: true;
  override: {
    version: 1;
    plexUserId: string;
    mediaType: 'movie' | 'tv';
    targetKind: 'immaculate_profile' | 'watched_collection';
    targetId: string;
    relativePosterPath: string;
    mimeType: string;
    size: number;
    updatedAt: string;
  };
  appliedNow: boolean;
  warnings?: string[];
};

export async function getManagedCollectionArtworkTargets(plexUserId: string) {
  const search = new URLSearchParams({ plexUserId: plexUserId.trim() });
  return await fetchJson<CollectionArtworkManagedCollectionsResponse>(
    apiPath(`/collection-artwork/managed-collections?${search.toString()}`),
  );
}

export async function uploadCollectionArtworkOverride(params: {
  plexUserId: string;
  mediaType: 'movie' | 'tv';
  targetKind: 'immaculate_profile' | 'watched_collection';
  targetId: string;
  file: File;
}) {
  const form = new FormData();
  form.set('plexUserId', params.plexUserId);
  form.set('mediaType', params.mediaType);
  form.set('targetKind', params.targetKind);
  form.set('targetId', params.targetId);
  form.set('file', params.file);

  const response = await fetch(apiPath('/collection-artwork/override'), {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!response.ok) {
    const { message, body } = await readApiError(response);
    throw new ApiError(response.status, message, body);
  }
  return (await response.json()) as UploadCollectionArtworkOverrideResponse;
}

export async function deleteCollectionArtworkOverride(params: {
  plexUserId: string;
  mediaType: 'movie' | 'tv';
  targetKind: 'immaculate_profile' | 'watched_collection';
  targetId: string;
}) {
  return await fetchJson<{ ok: true }>(apiPath('/collection-artwork/override'), {
    method: 'DELETE',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
}
