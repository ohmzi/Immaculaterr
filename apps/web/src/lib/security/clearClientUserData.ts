export async function clearClientUserData(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }

  try {
    if ('caches' in window) {
      const names = await window.caches.keys();
      await Promise.all(names.map((name) => window.caches.delete(name)));
    }
  } catch {
    // ignore
  }

  try {
    const idb = window.indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };
    if (typeof idb.databases !== 'function') return;
    const dbs = await idb.databases();
    for (const db of dbs) {
      const name = typeof db.name === 'string' ? db.name : '';
      if (!name) continue;
      try {
        idb.deleteDatabase(name);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

