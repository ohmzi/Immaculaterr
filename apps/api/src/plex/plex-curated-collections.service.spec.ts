import { PlexCuratedCollectionsService } from './plex-curated-collections.service';

function createTestCtx() {
  return {
    info: jest.fn(async () => undefined),
    warn: jest.fn(async () => undefined),
    debug: jest.fn(async () => undefined),
  };
}

describe('PlexCuratedCollectionsService hub pinning', () => {
  it('pins admin target to recommended+home and reorders as 1,2,3', async () => {
    const plexServer = {
      listCollectionsForSectionKey: jest.fn(async () => [
        { ratingKey: '11', title: 'Based on your recently watched movie (Alice)' },
        { ratingKey: '12', title: 'Change of Taste (Alice)' },
        { ratingKey: '13', title: 'Inspired by your Immaculate Taste (Alice)' },
      ]),
      setCollectionHubVisibility: jest.fn(async () => undefined),
      getCollectionHubIdentifier: jest.fn(
        async (args: { collectionRatingKey: string }) =>
          `hub-${args.collectionRatingKey}`,
      ),
      moveHubRow: jest.fn(async () => undefined),
    } as any;

    const service = new PlexCuratedCollectionsService(plexServer);
    const ctx = createTestCtx();

    await (service as any).pinCuratedCollectionHubs({
      ctx,
      baseUrl: 'http://plex.local:32400',
      token: 'token',
      librarySectionKey: '1',
      mediaType: 'movie',
      pinTarget: 'admin',
      // Intentionally old/wrong order to verify it is normalized before pinning.
      collectionHubOrder: [
        'Based on your recently watched movie (Alice)',
        'Inspired by your Immaculate Taste (Alice)',
        'Change of Taste (Alice)',
      ],
    });

    expect(plexServer.setCollectionHubVisibility).toHaveBeenCalledTimes(3);
    for (const call of plexServer.setCollectionHubVisibility.mock.calls) {
      expect(call[0]).toMatchObject({
        promotedToRecommended: 1,
        promotedToOwnHome: 1,
        promotedToSharedHome: 0,
      });
    }

    expect(plexServer.moveHubRow).toHaveBeenCalledTimes(3);
    expect(plexServer.moveHubRow.mock.calls[0][0]).toMatchObject({
      identifier: 'hub-11',
      after: null,
    });
    expect(plexServer.moveHubRow.mock.calls[1][0]).toMatchObject({
      identifier: 'hub-12',
      after: 'hub-11',
    });
    expect(plexServer.moveHubRow.mock.calls[2][0]).toMatchObject({
      identifier: 'hub-13',
      after: 'hub-12',
    });
  });

  it('pins friends target to shared home and matches by base when suffix differs', async () => {
    const plexServer = {
      listCollectionsForSectionKey: jest.fn(async () => [
        { ratingKey: '31', title: 'Inspired by your Immaculate Taste (Bob)' },
        { ratingKey: '32', title: 'Based on your recently watched show (Bob)' },
        { ratingKey: '33', title: 'Change of Taste (Bob)' },
      ]),
      setCollectionHubVisibility: jest.fn(async () => undefined),
      getCollectionHubIdentifier: jest.fn(
        async (args: { collectionRatingKey: string }) =>
          `hub-${args.collectionRatingKey}`,
      ),
      moveHubRow: jest.fn(async () => undefined),
    } as any;

    const service = new PlexCuratedCollectionsService(plexServer);
    const ctx = createTestCtx();

    await (service as any).pinCuratedCollectionHubs({
      ctx,
      baseUrl: 'http://plex.local:32400',
      token: 'token',
      librarySectionKey: '2',
      mediaType: 'tv',
      pinTarget: 'friends',
      // Requested for a different user; fallback should still match Bob's rows by base type.
      collectionHubOrder: [
        'Based on your recently watched show (Alice)',
        'Change of Taste (Alice)',
        'Inspired by your Immaculate Taste (Alice)',
      ],
    });

    expect(plexServer.setCollectionHubVisibility).toHaveBeenCalledTimes(3);
    for (const call of plexServer.setCollectionHubVisibility.mock.calls) {
      expect(call[0]).toMatchObject({
        promotedToRecommended: 0,
        promotedToOwnHome: 0,
        promotedToSharedHome: 1,
      });
    }

    expect(plexServer.moveHubRow).toHaveBeenCalledTimes(3);
    expect(plexServer.moveHubRow.mock.calls[0][0]).toMatchObject({
      identifier: 'hub-32',
      after: null,
    });
    expect(plexServer.moveHubRow.mock.calls[1][0]).toMatchObject({
      identifier: 'hub-33',
      after: 'hub-32',
    });
    expect(plexServer.moveHubRow.mock.calls[2][0]).toMatchObject({
      identifier: 'hub-31',
      after: 'hub-33',
    });
  });
});
