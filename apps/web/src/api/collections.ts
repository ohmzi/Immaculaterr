import { fetchJson } from '@/api/http';

export type CuratedCollection = {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CuratedCollectionItem = {
  id: number;
  ratingKey: string;
  title: string;
};

export function listCollections() {
  return fetchJson<{ collections: CuratedCollection[] }>('/api/collections');
}

export function createCollection(name: string) {
  return fetchJson<{ ok: true; collection: CuratedCollection }>('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function seedDefaultCollections() {
  return fetchJson<{ ok: true; collections: CuratedCollection[] }>('/api/collections/seed-defaults', {
    method: 'POST',
  });
}

export function deleteCollection(collectionId: string) {
  return fetchJson<{ ok: true }>(`/api/collections/${encodeURIComponent(collectionId)}`, {
    method: 'DELETE',
  });
}

export function listCollectionItems(collectionId: string) {
  return fetchJson<{ items: CuratedCollectionItem[] }>(
    `/api/collections/${encodeURIComponent(collectionId)}/items`,
  );
}

export function addCollectionItem(params: {
  collectionId: string;
  title?: string;
  ratingKey?: string;
}) {
  const { collectionId, title, ratingKey } = params;
  return fetchJson<{ ok: true; item: CuratedCollectionItem }>(
    `/api/collections/${encodeURIComponent(collectionId)}/items`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, ratingKey }),
    },
  );
}

export function deleteCollectionItem(params: { collectionId: string; itemId: number }) {
  const { collectionId, itemId } = params;
  return fetchJson<{ ok: true }>(
    `/api/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(String(itemId))}`,
    {
      method: 'DELETE',
    },
  );
}

export function importCollectionJson(params: { collectionId: string; json: string }) {
  const { collectionId, json } = params;
  return fetchJson<{ ok: true; result: { imported: number; skipped: number } }>(
    `/api/collections/${encodeURIComponent(collectionId)}/import-json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json }),
    },
  );
}

export function exportCollectionJson(collectionId: string) {
  return fetchJson<{ ok: true; items: Array<{ ratingKey: string; title: string }> }>(
    `/api/collections/${encodeURIComponent(collectionId)}/export-json`,
  );
}


