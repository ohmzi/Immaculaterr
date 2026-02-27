import { PlexCuratedCollectionsService } from './plex-curated-collections.service';

const createTestCtx = () => ({
  dryRun: false,
  info: jest.fn(() => undefined),
  warn: jest.fn(() => undefined),
  debug: jest.fn(() => undefined),
  patchSummary: jest.fn(() => undefined),
});

type PinCuratedCollectionHubsParams = {
  ctx: ReturnType<typeof createTestCtx>;
  baseUrl: string;
  token: string;
  librarySectionKey: string;
  mediaType: 'movie' | 'tv';
  pinTarget: 'admin' | 'friends';
  collectionHubOrder: string[];
  preferredHubTargets?: Array<{ collectionName: string; collectionKey: string }>;
};

const callPinCuratedCollectionHubs = async (
  service: PlexCuratedCollectionsService,
  params: PinCuratedCollectionHubsParams,
) => {
  const internal = service as unknown as {
    pinCuratedCollectionHubs: (
      params: PinCuratedCollectionHubsParams,
    ) => Promise<void>;
  };
  await internal.pinCuratedCollectionHubs(params);
};

describe('PlexCuratedCollectionsService hub pinning', () => {
  it('pins admin target to recommended+home and reorders as 1,2,3', async () => {
    const plexServer = {
      listCollectionsForSectionKey: jest.fn(() => Promise.resolve([
        { ratingKey: '11', title: 'Based on your recently watched movie (Alice)' },
        { ratingKey: '12', title: 'Change of Taste (Alice)' },
        { ratingKey: '13', title: 'Inspired by your Immaculate Taste (Alice)' },
      ])),
      setCollectionHubVisibility: jest.fn(() => Promise.resolve()),
      getCollectionHubIdentifier: jest.fn(
        (args: { collectionRatingKey: string }) =>
          Promise.resolve(`hub-${args.collectionRatingKey}`),
      ),
      moveHubRow: jest.fn(() => Promise.resolve()),
    };

    const service = new PlexCuratedCollectionsService(
      plexServer as unknown as ConstructorParameters<
        typeof PlexCuratedCollectionsService
      >[0],
    );
    const ctx = createTestCtx();

    await callPinCuratedCollectionHubs(service, {
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
      identifier: 'hub-13',
      after: null,
    });
    expect(plexServer.moveHubRow.mock.calls[1][0]).toMatchObject({
      identifier: 'hub-12',
      after: null,
    });
    expect(plexServer.moveHubRow.mock.calls[2][0]).toMatchObject({
      identifier: 'hub-11',
      after: null,
    });
  });

  it('pins friends target to shared home and matches by base when suffix differs', async () => {
    const plexServer = {
      listCollectionsForSectionKey: jest.fn(() => Promise.resolve([
        { ratingKey: '31', title: 'Inspired by your Immaculate Taste (Bob)' },
        { ratingKey: '32', title: 'Based on your recently watched show (Bob)' },
        { ratingKey: '33', title: 'Change of Taste (Bob)' },
      ])),
      setCollectionHubVisibility: jest.fn(() => undefined),
      getCollectionHubIdentifier: jest.fn(
        (args: { collectionRatingKey: string }) =>
          Promise.resolve(`hub-${args.collectionRatingKey}`),
      ),
      moveHubRow: jest.fn(() => Promise.resolve()),
    };

    const service = new PlexCuratedCollectionsService(
      plexServer as unknown as ConstructorParameters<
        typeof PlexCuratedCollectionsService
      >[0],
    );
    const ctx = createTestCtx();

    await callPinCuratedCollectionHubs(service, {
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
      identifier: 'hub-31',
      after: null,
    });
    expect(plexServer.moveHubRow.mock.calls[1][0]).toMatchObject({
      identifier: 'hub-33',
      after: null,
    });
    expect(plexServer.moveHubRow.mock.calls[2][0]).toMatchObject({
      identifier: 'hub-32',
      after: null,
    });
  });

  it('retries hub target resolution when a freshly rebuilt collection is not visible on first list call', async () => {
    const firstList = [
      { ratingKey: '41', title: 'Based on your recently watched movie (plex laking)' },
      { ratingKey: '42', title: 'Change of Taste (plex laking)' },
    ];
    const secondList = [
      ...firstList,
      { ratingKey: '43', title: 'Inspired by your Immaculate Taste (plex laking)' },
    ];

    const plexServer = {
      listCollectionsForSectionKey: jest
        .fn()
        .mockResolvedValueOnce(firstList)
        .mockResolvedValue(secondList),
      setCollectionHubVisibility: jest.fn(() => Promise.resolve()),
      getCollectionHubIdentifier: jest.fn(
        (args: { collectionRatingKey: string }) =>
          `hub-${args.collectionRatingKey}`,
      ),
      moveHubRow: jest.fn(() => Promise.resolve()),
    };

    const service = new PlexCuratedCollectionsService(
      plexServer as unknown as ConstructorParameters<
        typeof PlexCuratedCollectionsService
      >[0],
    );
    const ctx = createTestCtx();

    await callPinCuratedCollectionHubs(service, {
      ctx,
      baseUrl: 'http://plex.local:32400',
      token: 'token',
      librarySectionKey: '1',
      mediaType: 'movie',
      pinTarget: 'friends',
      collectionHubOrder: [
        'Based on your recently watched movie (plex laking)',
        'Change of Taste (plex laking)',
        'Inspired by your Immaculate Taste (plex laking)',
      ],
    });

    expect(plexServer.listCollectionsForSectionKey).toHaveBeenCalledTimes(2);
    expect(plexServer.setCollectionHubVisibility).toHaveBeenCalledTimes(3);
    expect(plexServer.moveHubRow).toHaveBeenCalledTimes(3);
  });

  it('pins the freshly rebuilt collection using preferred key even when list endpoint still misses it', async () => {
    const plexServer = {
      listCollectionsForSectionKey: jest.fn(() => [
        { ratingKey: '61', title: 'Based on your recently watched movie (plex laking)' },
        { ratingKey: '62', title: 'Change of Taste (plex laking)' },
      ]),
      setCollectionHubVisibility: jest.fn(() => undefined),
      getCollectionHubIdentifier: jest
        .fn()
        .mockImplementation((args: { collectionRatingKey: string }) => {
          if (args.collectionRatingKey === '63') {
            // Simulate eventual consistency in hub manage endpoint.
            const getCollectionHubIdentifierMock =
              plexServer.getCollectionHubIdentifier as jest.Mock;
            const seen = getCollectionHubIdentifierMock.mock.calls.filter(
              (call: Array<{ collectionRatingKey: string }>) =>
                call[0].collectionRatingKey === '63',
            ).length;
            return Promise.resolve(seen >= 2 ? 'hub-63' : null);
          }
          return Promise.resolve(`hub-${args.collectionRatingKey}`);
        }),
      moveHubRow: jest.fn(() => Promise.resolve()),
    };

    const service = new PlexCuratedCollectionsService(
      plexServer as unknown as ConstructorParameters<
        typeof PlexCuratedCollectionsService
      >[0],
    );
    const ctx = createTestCtx();

    await callPinCuratedCollectionHubs(service, {
      ctx,
      baseUrl: 'http://plex.local:32400',
      token: 'token',
      librarySectionKey: '1',
      mediaType: 'movie',
      pinTarget: 'friends',
      collectionHubOrder: [
        'Based on your recently watched movie (plex laking)',
        'Change of Taste (plex laking)',
        'Inspired by your Immaculate Taste (plex laking)',
      ],
      preferredHubTargets: [
        {
          collectionName: 'Inspired by your Immaculate Taste (plex laking)',
          collectionKey: '63',
        },
      ],
    });

    expect(plexServer.listCollectionsForSectionKey).toHaveBeenCalledTimes(1);
    expect(plexServer.setCollectionHubVisibility).toHaveBeenCalledTimes(3);
    expect(plexServer.setCollectionHubVisibility).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionRatingKey: '63',
        promotedToSharedHome: 1,
        promotedToOwnHome: 0,
        promotedToRecommended: 0,
      }),
    );
    expect(plexServer.moveHubRow).toHaveBeenCalledTimes(3);
    expect(plexServer.moveHubRow.mock.calls[0][0]).toMatchObject({
      identifier: 'hub-63',
      after: null,
    });
  });
});

describe('PlexCuratedCollectionsService rebuild fallback', () => {
  it('retries create without seed item when seeded create fails and still adds all desired items', async () => {
    const desired = [
      { ratingKey: '233616', title: 'Game of Thrones' },
      { ratingKey: '233617', title: 'Breaking Bad' },
    ];

    const plexServer = {
      listCollectionsForSectionKey: jest.fn(() => Promise.resolve([])),
      findCollectionRatingKey: jest.fn(() => Promise.resolve(null)),
      createCollection: jest
        .fn()
        .mockRejectedValueOnce(new Error('HTTP 500'))
        .mockResolvedValueOnce('new-tv'),
      getCollectionItems: jest
        .fn()
        // Immediately after create-without-uri fallback: collection is empty.
        .mockResolvedValueOnce([])
        // Best-effort final order fetch after move operations.
        .mockResolvedValue([
          { ratingKey: '233616', title: 'Game of Thrones' },
          { ratingKey: '233617', title: 'Breaking Bad' },
        ]),
      addItemToCollection: jest.fn(() => Promise.resolve()),
      setCollectionSort: jest.fn(() => undefined),
      moveCollectionItem: jest.fn(() => Promise.resolve()),
      uploadCollectionPoster: jest.fn(() => Promise.resolve()),
      uploadCollectionBackground: jest.fn(() => undefined),
    };

    const service = new PlexCuratedCollectionsService(
      plexServer as unknown as ConstructorParameters<
        typeof PlexCuratedCollectionsService
      >[0],
    );
    const ctx = createTestCtx();

    const result = await service.rebuildMovieCollection({
      ctx: ctx as unknown as Parameters<
        PlexCuratedCollectionsService['rebuildMovieCollection']
      >[0]['ctx'],
      baseUrl: 'http://plex.local:32400',
      token: 'token',
      machineIdentifier: 'machine-1',
      movieSectionKey: '3',
      itemType: 2,
      collectionName: 'Based on your recently watched show (ohmz_i)',
      desiredItems: desired,
      randomizeOrder: false,
      pinCollections: false,
    });

    expect(plexServer.createCollection).toHaveBeenCalledTimes(2);
    expect(plexServer.createCollection.mock.calls[0][0]).toMatchObject({
      initialItemRatingKey: '233616',
      type: 2,
      librarySectionKey: '3',
    });
    expect(plexServer.createCollection.mock.calls[1][0]).toMatchObject({
      initialItemRatingKey: null,
      type: 2,
      librarySectionKey: '3',
    });

    expect(plexServer.addItemToCollection).toHaveBeenCalledTimes(2);
    expect(plexServer.addItemToCollection.mock.calls[0][0]).toMatchObject({
      collectionRatingKey: 'new-tv',
      itemRatingKey: '233616',
    });
    expect(plexServer.addItemToCollection.mock.calls[1][0]).toMatchObject({
      collectionRatingKey: 'new-tv',
      itemRatingKey: '233617',
    });

    expect(result).toMatchObject({
      plexCollectionKey: 'new-tv',
      desiredCount: 2,
    });
  });
});
