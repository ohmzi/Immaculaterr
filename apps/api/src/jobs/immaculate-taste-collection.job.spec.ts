import type { JobContext, JsonObject } from './jobs.types';
import { buildImmaculateTastePointsReport } from './immaculate-taste-collection.job';

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

describe('buildImmaculateTastePointsReport', () => {
  it('aggregates newly added collection titles across profile-specific and default refreshers', () => {
    const animationRefresherRaw: JsonObject = {
      profileId: 'animation',
      profileName: 'Animation',
      movie: {
        collectionName: 'Inispired by your Immaculate Animation Movie Taste',
        plexByLibrary: [
          {
            library: 'Movies',
            plex: {
              collectionName:
                'Inispired by your Immaculate Animation Movie Taste',
              collectionItems: ['Luca', 'Flow'],
              collectionItemsSource: 'plex',
              newCollectionItems: ['Flow'],
            },
          },
        ],
      },
      tv: { skipped: true, reason: 'disabled' },
    };
    const defaultRefresherRaw: JsonObject = {
      profileId: 'default',
      profileName: 'Default',
      movie: {
        collectionName: 'Inspired by your Immaculate Taste in Movies',
        plexByLibrary: [
          {
            library: 'Movies',
            plex: {
              collectionName:
                'Inspired by your Immaculate Taste in Movies (ohmz_i)',
              collectionItems: ['Luca', 'Cars 3'],
              collectionItemsSource: 'plex',
              newCollectionItems: ['Cars 3'],
            },
          },
        ],
      },
      tv: { skipped: true, reason: 'disabled' },
    };

    const raw: JsonObject = {
      mediaType: 'movie',
      plexUserId: 'plex-admin',
      plexUserTitle: 'ohmz_i',
      seedTitle: 'Luca',
      seedYear: 2021,
      generated: 2,
      resolvedInPlex: 2,
      missingInPlex: 0,
      generatedTitles: ['Flow', 'Cars 3'],
      resolvedTitles: ['Flow', 'Cars 3'],
      missingTitles: [],
      excludedByRejectListCount: 0,
      excludedByRejectListTitles: [],
      recommendationStrategy: 'tmdb',
      profileMatch: {
        matched: true,
        reason: 'matched_profile',
        profileName: 'Animation',
        profileId: 'animation',
        profileDatasetId: 'animation',
        seedMediaType: 'movie',
        profileMediaType: 'both',
        profileMatchMode: 'any',
        includeGenres: ['Animation'],
        includeAudioLanguages: [],
        excludedGenres: [],
        excludedAudioLanguages: [],
        matchedProfileCount: 2,
        matchedProfileIds: ['animation', 'default'],
        matchedProfileDatasetIds: ['animation', 'default'],
      },
      points: {
        totalBefore: 10,
        totalAfter: 12,
        totalActiveBefore: 4,
        totalActiveAfter: 6,
        totalPendingBefore: 6,
        totalPendingAfter: 6,
        createdActive: 2,
        createdPending: 0,
        activatedFromPending: 0,
        decayed: 0,
        removed: 0,
      },
      refresher: {
        template: 'jobReportV1',
        version: 1,
        raw: animationRefresherRaw,
      },
      refresherByProfile: [
        {
          profileId: 'animation',
          profileDatasetId: 'animation',
          profileName: 'Animation',
          collectionProfileId: 'animation',
          refresher: {
            template: 'jobReportV1',
            version: 1,
            raw: animationRefresherRaw,
          },
        },
        {
          profileId: 'default',
          profileDatasetId: 'default',
          profileName: 'Default',
          collectionProfileId: 'default',
          refresher: {
            template: 'jobReportV1',
            version: 1,
            raw: defaultRefresherRaw,
          },
        },
      ],
    };

    const report = buildImmaculateTastePointsReport({
      ctx: createCtx('immaculateTastePoints'),
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
            count: 1,
            unit: 'movies',
            items: ['Flow'],
            order: 'plex',
          },
        },
        {
          label: 'Movie collection (Default) — Movies',
          value: {
            count: 1,
            unit: 'movies',
            items: ['Cars 3'],
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
          profileLabel: 'Animation',
          profileId: 'animation',
          collectionProfileId: 'animation',
          library: 'Movies',
          collectionName: 'Inispired by your Immaculate Animation Movie Taste',
          count: 1,
          unit: 'movies',
          items: ['Flow'],
        },
        {
          mediaType: 'movie',
          profileLabel: 'Default',
          profileId: 'default',
          collectionProfileId: 'default',
          library: 'Movies',
          collectionName: 'Inspired by your Immaculate Taste in Movies',
          count: 1,
          unit: 'movies',
          items: ['Cars 3'],
        },
      ],
    });
  });
});
