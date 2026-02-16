import {
  buildCollectionResyncQueueItemKey,
  COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY,
  CollectionResyncUpgradeJob,
  type CollectionResyncQueueItem,
  getPendingQueueItemsInOrder,
} from './collection-resync-upgrade.job';
import type { JobContext, JsonObject } from './jobs.types';

function createCtx(): JobContext {
  let summary: JsonObject | null = null;
  const log = jest.fn(async () => undefined);
  return {
    jobId: 'collectionResyncUpgrade',
    runId: 'run-1',
    userId: 'user-1',
    dryRun: false,
    trigger: 'auto',
    getSummary: () => summary,
    setSummary: jest.fn(async (next: JsonObject | null) => {
      summary = next;
    }),
    patchSummary: jest.fn(async (patch: JsonObject) => {
      summary = { ...(summary ?? {}), ...(patch ?? {}) };
    }),
    log,
    debug: log,
    info: log,
    warn: log,
    error: log,
  };
}

function createQueueItem(params: {
  plexUserId: string;
  mediaType: 'movie' | 'tv';
  librarySectionKey: string;
  collectionBaseName: string;
}): CollectionResyncQueueItem {
  const key = buildCollectionResyncQueueItemKey(params);
  return {
    key,
    plexUserId: params.plexUserId,
    mediaType: params.mediaType,
    librarySectionKey: params.librarySectionKey,
    collectionBaseName: params.collectionBaseName,
    targetCollectionName: `${params.collectionBaseName} (User)`,
    sourceTable: 'WatchedMovieRecommendationLibrary',
    rowCount: 1,
    activeRowCount: 1,
    pinTarget: 'friends',
  };
}

describe('CollectionResyncUpgradeJob', () => {
  it('is idempotent when completedAt already exists', async () => {
    const prisma = {
      setting: {
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) => {
          if (where.key === COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY) {
            return { value: '2026-02-16T00:00:00.000Z' };
          }
          return null;
        }),
      },
    } as unknown as ConstructorParameters<typeof CollectionResyncUpgradeJob>[0];

    const plexServer = {
      deleteCollection: jest.fn(),
    } as unknown as ConstructorParameters<typeof CollectionResyncUpgradeJob>[4];

    const job = new CollectionResyncUpgradeJob(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      plexServer as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await job.run(createCtx());
    const report = result.summary as unknown as Record<string, unknown>;
    const tasks = (report['tasks'] ?? []) as Array<Record<string, unknown>>;

    expect(report['headline']).toBe(
      'Collection resync upgrade already completed.',
    );
    expect(tasks.length).toBe(4);
    expect(tasks.every((task) => task['status'] === 'skipped')).toBe(true);
    expect(plexServer.deleteCollection).not.toHaveBeenCalled();
  });

  it('keeps queue processing order deterministic (sequential)', () => {
    const first = createQueueItem({
      plexUserId: 'u-1',
      mediaType: 'movie',
      librarySectionKey: '1',
      collectionBaseName: 'Based on your recently watched movie',
    });
    const second = createQueueItem({
      plexUserId: 'u-1',
      mediaType: 'tv',
      librarySectionKey: '2',
      collectionBaseName: 'Based on your recently watched show',
    });
    const third = createQueueItem({
      plexUserId: 'u-2',
      mediaType: 'movie',
      librarySectionKey: '3',
      collectionBaseName: 'Change of Taste',
    });

    const ordered = getPendingQueueItemsInOrder({
      queue: [first, second, third],
      itemProgress: {
        [first.key]: { phase: 'captured' },
        [second.key]: { phase: 'pending' },
        [third.key]: { phase: 'recreated' },
      },
    });

    expect(ordered.map((item) => item.key)).toEqual([
      first.key,
      second.key,
      third.key,
    ]);
  });

  it('resumes only incomplete items after a crash/restart', () => {
    const first = createQueueItem({
      plexUserId: 'u-1',
      mediaType: 'movie',
      librarySectionKey: '1',
      collectionBaseName: 'Based on your recently watched movie',
    });
    const second = createQueueItem({
      plexUserId: 'u-1',
      mediaType: 'tv',
      librarySectionKey: '2',
      collectionBaseName: 'Based on your recently watched show',
    });
    const third = createQueueItem({
      plexUserId: 'u-2',
      mediaType: 'movie',
      librarySectionKey: '3',
      collectionBaseName: 'Inspired by your Immaculate Taste',
    });

    const pending = getPendingQueueItemsInOrder({
      queue: [first, second, third],
      itemProgress: {
        [first.key]: { phase: 'done' },
        [second.key]: { phase: 'failed' },
        [third.key]: { phase: 'done' },
      },
    });

    expect(pending.map((item) => item.key)).toEqual([second.key]);
  });
});
