type IndexedDbFactoryWithDatabases = IDBFactory & {
  databases?: () => Promise<Array<{ name?: string }>>;
};

async function runSafely(task: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await task();
  } catch {
    // ignore
  }
}

async function clearStorage(storage: Storage): Promise<void> {
  await runSafely(() => storage.clear());
}

async function clearCacheStorage(): Promise<void> {
  if (!('caches' in window)) return;
  const cacheNames = await window.caches.keys();
  await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
}

function resolveIndexedDbNames(
  databases: Array<{ name?: string }>,
): string[] {
  return databases
    .map((database) => (typeof database.name === 'string' ? database.name : ''))
    .filter((name) => name.length > 0);
}

async function clearIndexedDb(): Promise<void> {
  const indexedDb = window.indexedDB as IndexedDbFactoryWithDatabases;
  if (typeof indexedDb.databases !== 'function') return;

  const databases = await indexedDb.databases();
  const databaseNames = resolveIndexedDbNames(databases);
  for (const databaseName of databaseNames) {
    await runSafely(() => indexedDb.deleteDatabase(databaseName));
  }
}

export async function clearClientUserData(): Promise<void> {
  if (typeof window === 'undefined') return;

  await clearStorage(window.localStorage);
  await clearStorage(window.sessionStorage);
  await runSafely(clearCacheStorage);
  await runSafely(clearIndexedDb);
}
