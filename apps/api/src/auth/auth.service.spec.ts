import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

function createPrismaMock() {
  const deleteMany = () => jest.fn().mockResolvedValue({ count: 0 });
  return {
    user: {
      findMany: jest.fn(),
      deleteMany: deleteMany(),
    },
    userSettings: {
      findUnique: jest.fn(),
      deleteMany: deleteMany(),
    },
    userSecrets: {
      findUnique: jest.fn(),
      deleteMany: deleteMany(),
    },
    userRecovery: {
      deleteMany: deleteMany(),
    },
    session: {
      deleteMany: deleteMany(),
    },
    jobLogLine: {
      deleteMany: deleteMany(),
    },
    jobRun: {
      deleteMany: deleteMany(),
    },
    jobSchedule: {
      deleteMany: deleteMany(),
    },
    curatedCollectionItem: {
      deleteMany: deleteMany(),
    },
    curatedCollection: {
      deleteMany: deleteMany(),
    },
    watchedMovieRecommendationLibrary: {
      findMany: jest.fn(),
      deleteMany: deleteMany(),
    },
    watchedShowRecommendationLibrary: {
      findMany: jest.fn(),
      deleteMany: deleteMany(),
    },
    freshReleaseMovieLibrary: {
      deleteMany: deleteMany(),
    },
    freshReleaseShowLibrary: {
      deleteMany: deleteMany(),
    },
    immaculateTasteMovieLibrary: {
      deleteMany: deleteMany(),
    },
    immaculateTasteShowLibrary: {
      deleteMany: deleteMany(),
    },
    watchedMovieRecommendation: {
      findMany: jest.fn(),
      deleteMany: deleteMany(),
    },
    watchedShowRecommendation: {
      findMany: jest.fn(),
      deleteMany: deleteMany(),
    },
    immaculateTasteMovie: {
      deleteMany: deleteMany(),
    },
    immaculateTasteShow: {
      deleteMany: deleteMany(),
    },
    immaculateTasteProfileUserOverride: {
      deleteMany: deleteMany(),
    },
    immaculateTasteProfile: {
      findMany: jest.fn(),
      deleteMany: deleteMany(),
    },
    importedWatchEntry: {
      deleteMany: deleteMany(),
    },
    rejectedSuggestion: {
      deleteMany: deleteMany(),
    },
    arrInstance: {
      deleteMany: deleteMany(),
    },
    plexUser: {
      findMany: jest.fn(),
      deleteMany: deleteMany(),
    },
    setting: {
      deleteMany: deleteMany(),
    },
  };
}

function createService() {
  const prisma = createPrismaMock();
  const crypto = {
    encryptString: jest.fn((value: string) => value),
    decryptString: jest.fn((value: string) => value),
    isEncrypted: jest.fn(() => false),
  };
  const authThrottle = {
    assess: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  };
  const captcha = {
    verify: jest.fn(),
  };
  const credentialEnvelope = {
    getLoginKey: jest.fn(),
    decryptPayload: jest.fn(),
  };
  const passwordProof = {
    consumeChallenge: jest.fn(),
    buildExpectedProof: jest.fn(),
    matches: jest.fn(),
  };
  const plexServer = {
    getSections: jest.fn(),
    listCollectionsForSectionKey: jest.fn(),
    deleteCollection: jest.fn(),
  };

  const service = new AuthService(
    prisma as never,
    crypto as never,
    authThrottle as never,
    captcha as never,
    credentialEnvelope as never,
    passwordProof as never,
    plexServer as never,
  );
  return { service, prisma, plexServer };
}

describe('AuthService.resetAllData', () => {
  it('deletes matching Plex collections before fully wiping data', async () => {
    const { service, prisma, plexServer } = createService();
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    prisma.userSettings.findUnique.mockResolvedValue({
      value: JSON.stringify({ plex: { baseUrl: 'http://plex.local:32400' } }),
    });
    prisma.userSecrets.findUnique.mockResolvedValue({
      value: JSON.stringify({ plex: { token: 'plex-token' } }),
    });
    prisma.immaculateTasteProfile.findMany.mockResolvedValue([]);
    prisma.watchedMovieRecommendation.findMany.mockResolvedValue([
      { collectionName: 'Custom Movie Picks' },
    ]);
    prisma.watchedShowRecommendation.findMany.mockResolvedValue([]);
    prisma.watchedMovieRecommendationLibrary.findMany.mockResolvedValue([]);
    prisma.watchedShowRecommendationLibrary.findMany.mockResolvedValue([]);
    prisma.plexUser.findMany.mockResolvedValue([{ plexAccountTitle: 'alice' }]);

    const sectionCollections = new Map<
      string,
      Array<{ ratingKey: string; title: string }>
    >([
      [
        '1',
        [
          {
            ratingKey: 'm1',
            title: 'Inspired by your Immaculate Taste in Movies (alice)',
          },
          { ratingKey: 'm2', title: 'Unrelated Collection' },
        ],
      ],
      [
        '2',
        [
          {
            ratingKey: 't1',
            title: 'Based on your recently watched Show (alice)',
          },
        ],
      ],
    ]);

    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
      { key: '2', title: 'TV', type: 'show' },
    ]);
    plexServer.listCollectionsForSectionKey.mockImplementation(
      ({ librarySectionKey }: { librarySectionKey: string }) =>
        Promise.resolve(sectionCollections.get(librarySectionKey) ?? []),
    );
    plexServer.deleteCollection.mockImplementation(
      ({ collectionRatingKey }: { collectionRatingKey: string }) => {
        for (const [sectionKey, items] of sectionCollections.entries()) {
          sectionCollections.set(
            sectionKey,
            items.filter((item) => item.ratingKey !== collectionRatingKey),
          );
        }
        return Promise.resolve();
      },
    );

    await service.resetAllData();

    expect(plexServer.deleteCollection).toHaveBeenCalledTimes(2);
    expect(
      (sectionCollections.get('1') ?? []).map((item) => item.ratingKey),
    ).toEqual(['m2']);
    expect(sectionCollections.get('2')).toEqual([]);
    expect(prisma.plexUser.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.immaculateTasteProfile.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.setting.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('continues reset when a legacy table is missing', async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.userRecovery.deleteMany.mockRejectedValueOnce({
      code: 'P2021',
      meta: { table: 'main.UserRecovery' },
    });

    await service.resetAllData();

    expect(prisma.userRecovery.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.userSecrets.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.userSettings.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.setting.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('fails reset when Plex cleanup cannot fully remove matching collections', async () => {
    const { service, prisma, plexServer } = createService();
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    prisma.userSettings.findUnique.mockResolvedValue({
      value: JSON.stringify({ plex: { baseUrl: 'http://plex.local:32400' } }),
    });
    prisma.userSecrets.findUnique.mockResolvedValue({
      value: JSON.stringify({ plex: { token: 'plex-token' } }),
    });
    prisma.immaculateTasteProfile.findMany.mockResolvedValue([]);
    prisma.watchedMovieRecommendation.findMany.mockResolvedValue([]);
    prisma.watchedShowRecommendation.findMany.mockResolvedValue([]);
    prisma.watchedMovieRecommendationLibrary.findMany.mockResolvedValue([]);
    prisma.watchedShowRecommendationLibrary.findMany.mockResolvedValue([]);
    prisma.plexUser.findMany.mockResolvedValue([]);

    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);
    plexServer.listCollectionsForSectionKey.mockResolvedValue([
      { ratingKey: 'm1', title: 'Immaculate Taste (Movies)' },
    ]);
    plexServer.deleteCollection.mockRejectedValue(
      new Error('permission denied'),
    );

    await expect(service.resetAllData()).rejects.toThrow(BadRequestException);
    expect(prisma.jobLogLine.deleteMany).not.toHaveBeenCalled();
  });
});
