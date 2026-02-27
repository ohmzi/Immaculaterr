import { fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS } from '@/api/constants';

export type ImmaculateTasteCollectionsResponse = {
  collectionName: string;
  collections: Array<{
    mediaType: 'movie' | 'tv';
    librarySectionKey: string;
    libraryTitle: string;
    dataset: { total: number; active: number; pending: number };
    plex: {
      collectionName: string;
      collectionRatingKey: string | null;
      itemCount: number | null;
    };
  }>;
};

export type ImmaculateTasteUserSummaryResponse = {
  users: Array<{
    id: string;
    plexAccountTitle: string;
    isAdmin: boolean;
    movieCount: number;
    tvCount: number;
  }>;
};

export async function getImmaculateTasteCollections() {
  return await fetchJson<ImmaculateTasteCollectionsResponse>(
    apiPath('/immaculate-taste/collections'),
  );
}

export async function getImmaculateTasteUserSummary() {
  return await fetchJson<ImmaculateTasteUserSummaryResponse>(
    apiPath('/immaculate-taste/collections/users'),
  );
}

export const resetImmaculateTasteCollection = async (params: {
  mediaType: 'movie' | 'tv';
  librarySectionKey: string;
}) => {
  return await fetchJson<{
    ok: true;
    mediaType: 'movie' | 'tv';
    librarySectionKey: string;
    libraryTitle: string;
    plex: {
      collectionName: string;
      collectionRatingKey: string | null;
      deleted: boolean;
    };
    dataset: { deleted: number };
  }>(apiPath('/immaculate-taste/collections/reset'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
};

export async function resetImmaculateTasteUserCollection(params: {
  plexUserId: string;
  mediaType: 'movie' | 'tv';
}) {
  return await fetchJson<{
    ok: true;
    mediaType: 'movie' | 'tv';
    plexUserId: string;
    plexUserTitle: string;
    plex: {
      collectionName: string;
      deleted: number;
      libraries: number;
    };
    dataset: { deleted: number };
  }>(apiPath('/immaculate-taste/collections/reset-user'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
}


