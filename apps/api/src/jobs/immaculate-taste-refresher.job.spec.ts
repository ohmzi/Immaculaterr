import type { JobContext, JsonObject } from './jobs.types';
import { buildImmaculateTasteRefresherReport } from './immaculate-taste-refresher.job';

function createCtx(jobId: string): JobContext {
  return {
    jobId,
    runId: 'run-1',
    userId: 'user-1',
    dryRun: false,
    trigger: 'auto',
    getSummary: () => null,
    setSummary: jest.fn(() => Promise.resolve(undefined)),
    patchSummary: jest.fn(() => Promise.resolve(undefined)),
    log: jest.fn(() => Promise.resolve(undefined)),
    debug: jest.fn(() => Promise.resolve(undefined)),
    info: jest.fn(() => Promise.resolve(undefined)),
    warn: jest.fn(() => Promise.resolve(undefined)),
    error: jest.fn(() => Promise.resolve(undefined)),
  };
}

describe('buildImmaculateTasteRefresherReport', () => {
  it('adds a dedicated card and raw payload for titles newly added to a collection', () => {
    const raw: JsonObject = {
      mode: 'targeted',
      plexUserId: 'plex-admin',
      plexUserTitle: 'ohmz_i',
      profileId: 'animation',
      profileName: 'Animation',
      movie: {
        collectionName: 'Inispired by your Immaculate Animation Movie Taste',
        plexByLibrary: [
          {
            library: 'Movies',
            activatedNow: 0,
            sentToRadarr: 0,
            tmdbBackfilled: 0,
            plex: {
              collectionName:
                'Inispired by your Immaculate Animation Movie Taste',
              existingCount: 45,
              desiredCount: 47,
              collectionItems: ['Luca', 'Elemental', 'Flow'],
              collectionItemsSource: 'plex',
              newCollectionItems: ['Elemental', 'Flow'],
            },
          },
        ],
      },
      tv: {
        skipped: true,
        reason: 'disabled',
      },
    };

    const report = buildImmaculateTasteRefresherReport({
      ctx: createCtx('immaculateTasteRefresher'),
      raw,
    });

    expect(
      report.tasks.find((task) => task.id === 'collection_additions'),
    ).toMatchObject({
      status: 'success',
      facts: [
        {
          label: 'Movie collection (Animation) — Movies',
          value: {
            count: 2,
            unit: 'movies',
            items: ['Elemental', 'Flow'],
            order: 'plex',
          },
        },
      ],
    });

    expect(report.raw).toMatchObject({
      collectionAdditionsTotal: 2,
      collectionAdditionsByLibrary: [
        {
          mediaType: 'movie',
          scopeLabel: 'Animation',
          library: 'Movies',
          collectionName: 'Inispired by your Immaculate Animation Movie Taste',
          count: 2,
          unit: 'movies',
          items: ['Elemental', 'Flow'],
        },
      ],
    });
  });
});
