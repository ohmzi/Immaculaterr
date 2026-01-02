import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Download, Loader2, Plus, Trash2, Upload } from 'lucide-react';

import {
  addCollectionItem,
  createCollection,
  deleteCollection,
  deleteCollectionItem,
  exportCollectionJson,
  importCollectionJson,
  listCollectionItems,
  listCollections,
  seedDefaultCollections,
} from '@/api/collections';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CollectionsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newCollectionName, setNewCollectionName] = useState('');

  const [addTitle, setAddTitle] = useState('');
  const [addRatingKey, setAddRatingKey] = useState('');
  const [importText, setImportText] = useState('');

  const collectionsQuery = useQuery({
    queryKey: ['collections'],
    queryFn: listCollections,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const collections = useMemo(
    () => collectionsQuery.data?.collections ?? [],
    [collectionsQuery.data?.collections],
  );
  const activeCollectionId = selectedId ?? collections[0]?.id ?? null;

  const selected = useMemo(
    () => collections.find((c) => c.id === activeCollectionId) ?? null,
    [collections, activeCollectionId],
  );

  const itemsQuery = useQuery({
    queryKey: ['collectionItems', activeCollectionId],
    queryFn: () => listCollectionItems(activeCollectionId as string),
    enabled: Boolean(activeCollectionId),
    staleTime: 2_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const items = itemsQuery.data?.items ?? [];

  const createMutation = useMutation({
    mutationFn: async () => createCollection(newCollectionName),
    onSuccess: async (res) => {
      setNewCollectionName('');
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      setSelectedId(res.collection.id);
    },
  });

  const seedMutation = useMutation({
    mutationFn: seedDefaultCollections,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: async (id: string) => deleteCollection(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.removeQueries({ queryKey: ['collectionItems'] });
      setSelectedId(null);
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async () =>
      addCollectionItem({
        collectionId: activeCollectionId as string,
        title: addTitle.trim() || undefined,
        ratingKey: addRatingKey.trim() || undefined,
      }),
    onSuccess: async () => {
      setAddTitle('');
      setAddRatingKey('');
      await queryClient.invalidateQueries({ queryKey: ['collectionItems', activeCollectionId] });
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (params: { itemId: number }) =>
      deleteCollectionItem({ collectionId: activeCollectionId as string, itemId: params.itemId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collectionItems', activeCollectionId] });
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () =>
      importCollectionJson({ collectionId: activeCollectionId as string, json: importText }),
    onSuccess: async () => {
      setImportText('');
      await queryClient.invalidateQueries({ queryKey: ['collectionItems', activeCollectionId] });
      await queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => exportCollectionJson(activeCollectionId as string),
    onSuccess: (res) => {
      const name = (selected?.name ?? 'collection').replace(/[^\w\- ]+/g, '').trim() || 'collection';
      downloadJson(`${name}.json`, res.items);
    },
  });

  const isBusy =
    createMutation.isPending ||
    seedMutation.isPending ||
    deleteCollectionMutation.isPending ||
    addItemMutation.isPending ||
    deleteItemMutation.isPending ||
    importMutation.isPending ||
    exportMutation.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
        <p className="text-sm text-muted-foreground">
          Manage curated collections in the DB. The refresher job uses these items (no legacy JSON files).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Curated collections</CardTitle>
            <CardDescription>Create your own or seed the default ones.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
              >
                {seedMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Seeding…
                  </>
                ) : (
                  'Seed defaults'
                )}
              </Button>
            </div>

            <div className="grid gap-2">
              <Label>New collection</Label>
              <div className="flex gap-2">
                <Input
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="e.g. Based on your recently watched movie"
                />
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!newCollectionName.trim() || createMutation.isPending}
                >
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>

            {collectionsQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : collectionsQuery.error ? (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4" />
                <div>{(collectionsQuery.error as Error).message}</div>
              </div>
            ) : collections.length ? (
              <div className="space-y-2">
                {collections.map((c) => (
                  <button
                    key={c.id}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      selectedId === c.id ? 'bg-accent' : 'hover:bg-muted/30',
                    )}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.itemCount}</div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Updated: {new Date(c.updatedAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No collections yet. Click <span className="font-medium">Seed defaults</span> to create the two
                standard ones.
              </div>
            )}

            {createMutation.error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {(createMutation.error as Error).message}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
            <CardDescription>
              {selected ? (
                <>
                  Collection: <span className="font-medium">{selected.name}</span>
                </>
              ) : (
                'Select a collection to manage its items.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!selected ? (
              <div className="text-sm text-muted-foreground">Pick a collection on the left.</div>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Add item</div>
                    <div className="grid gap-2">
                      <Label>Title (recommended)</Label>
                      <Input
                        value={addTitle}
                        onChange={(e) => setAddTitle(e.target.value)}
                        placeholder="e.g. The Matrix"
                      />
                      <div className="text-xs text-muted-foreground">
                        We’ll resolve the Plex ratingKey automatically (requires Plex configured).
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>…or ratingKey</Label>
                      <Input
                        value={addRatingKey}
                        onChange={(e) => setAddRatingKey(e.target.value)}
                        placeholder="e.g. 12345"
                      />
                    </div>
                    <Button
                      onClick={() => addItemMutation.mutate()}
                      disabled={isBusy || (!addTitle.trim() && !addRatingKey.trim())}
                    >
                      {addItemMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Adding…
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4" />
                          Add item
                        </>
                      )}
                    </Button>
                    {addItemMutation.error ? (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                        {(addItemMutation.error as Error).message}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <div className="text-sm font-medium">Import / export</div>
                    <div className="grid gap-2">
                      <Label>Import JSON</Label>
                      <textarea
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                        placeholder='Paste JSON array: ["The Matrix", {"title":"Inception","ratingKey":"123"}]'
                        className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => importMutation.mutate()}
                        disabled={isBusy || !importText.trim()}
                      >
                        {importMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Importing…
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4" />
                            Import
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => exportMutation.mutate()}
                        disabled={isBusy}
                      >
                        {exportMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Exporting…
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            Export
                          </>
                        )}
                      </Button>
                    </div>
                    {importMutation.data ? (
                      <div className="rounded-lg border bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                        Imported: {importMutation.data.result.imported} • Skipped:{' '}
                        {importMutation.data.result.skipped}
                      </div>
                    ) : null}
                    {importMutation.error ? (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                        {(importMutation.error as Error).message}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">Current items</div>
                    <Button
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        const ok = window.confirm(
                          `Delete collection "${selected.name}" and all its items?`,
                        );
                        if (!ok) return;
                        deleteCollectionMutation.mutate(selected.id);
                      }}
                      disabled={deleteCollectionMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete collection
                    </Button>
                  </div>

                  {itemsQuery.isLoading ? (
                    <div className="text-sm text-muted-foreground">Loading…</div>
                  ) : itemsQuery.error ? (
                    <div className="flex items-start gap-2 text-sm text-destructive">
                      <CircleAlert className="mt-0.5 h-4 w-4" />
                      <div>{(itemsQuery.error as Error).message}</div>
                    </div>
                  ) : items.length ? (
                    <div className="overflow-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2">Title</th>
                            <th className="px-3 py-2">ratingKey</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it) => (
                            <tr key={it.id} className="border-t hover:bg-muted/20">
                              <td className="px-3 py-2">{it.title}</td>
                              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                {it.ratingKey}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deleteItemMutation.mutate({ itemId: it.id })}
                                  disabled={deleteItemMutation.isPending}
                                  aria-label="Remove item"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No items yet.</div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


