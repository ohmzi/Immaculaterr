import { BadRequestException } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';

describe('IntegrationsController plex libraries', () => {
  const makeController = () => {
    const prisma = {
      $transaction: jest.fn(),
      immaculateTasteMovieLibrary: { deleteMany: jest.fn() },
      immaculateTasteShowLibrary: { deleteMany: jest.fn() },
      watchedMovieRecommendationLibrary: { deleteMany: jest.fn() },
      watchedShowRecommendationLibrary: { deleteMany: jest.fn() },
    };
    const settingsService = {
      getInternalSettings: jest.fn(),
      updateSettings: jest.fn(),
    };
    const plexServer = {
      getSections: jest.fn(),
      listCollectionsForSectionKey: jest.fn(),
      deleteCollection: jest.fn(),
    };
    const overseerr = {
      testConnection: jest.fn(),
    };
    const controller = new IntegrationsController(
      prisma as never,
      settingsService as never,
      plexServer as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      overseerr as never,
    );
    return { controller, prisma, settingsService, plexServer, overseerr };
  };

  it('GET /plex/libraries returns selected state', async () => {
    const { controller, settingsService, plexServer } = makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        plex: {
          baseUrl: 'http://plex:32400',
          librarySelection: {
            excludedSectionKeys: ['2'],
          },
        },
      },
      secrets: {
        plex: { token: 'token' },
      },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
      { key: '2', title: 'Shows', type: 'show' },
      { key: '3', title: 'Photos', type: 'photo' },
    ]);

    const res = await controller.plexLibraries({
      user: { id: 'u1' },
    } as never);

    expect(res.ok).toBe(true);
    expect(res.libraries).toEqual([
      { key: '1', title: 'Movies', type: 'movie', selected: true },
      { key: '2', title: 'Shows', type: 'show', selected: false },
    ]);
    expect(res.selectedSectionKeys).toEqual(['1']);
    expect(res.excludedSectionKeys).toEqual(['2']);
    expect(res.minimumRequired).toBe(1);
    expect(res.autoIncludeNewLibraries).toBe(true);
  });

  it('PUT /plex/libraries rejects empty selectedSectionKeys', async () => {
    const { controller, settingsService, plexServer } = makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
    ]);

    await expect(
      controller.savePlexLibraries(
        { user: { id: 'u1' } } as never,
        { selectedSectionKeys: [] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('PUT /plex/libraries rejects unknown keys', async () => {
    const { controller, settingsService, plexServer } = makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
      { key: '2', title: 'Shows', type: 'show' },
    ]);

    await expect(
      controller.savePlexLibraries(
        { user: { id: 'u1' } } as never,
        { selectedSectionKeys: ['unknown'] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('PUT /plex/libraries persists excluded complement', async () => {
    const { controller, settingsService, plexServer } = makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: { plex: { baseUrl: 'http://plex:32400' } },
      secrets: { plex: { token: 'token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
      { key: '2', title: 'Shows', type: 'show' },
      { key: '3', title: 'Kids Movies', type: 'movie' },
    ]);
    settingsService.updateSettings.mockResolvedValue({
      plex: {
        baseUrl: 'http://plex:32400',
        librarySelection: { excludedSectionKeys: ['3', '1'] },
      },
    });

    const res = await controller.savePlexLibraries(
      { user: { id: 'u1' } } as never,
      { selectedSectionKeys: ['2'] },
    );

    expect(settingsService.updateSettings).toHaveBeenCalledWith('u1', {
      plex: {
        librarySelection: {
          excludedSectionKeys: ['3', '1'],
        },
      },
    });
    expect(res.selectedSectionKeys).toEqual(['2']);
    expect(res.excludedSectionKeys).toEqual(['3', '1']);
  });

  it('PUT /plex/libraries cleans deselected library data and curated Plex collections', async () => {
    const { controller, prisma, settingsService, plexServer } = makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        plex: {
          baseUrl: 'http://plex:32400',
          librarySelection: { excludedSectionKeys: [] },
        },
      },
      secrets: { plex: { token: 'token' } },
    });
    plexServer.getSections.mockResolvedValue([
      { key: '1', title: 'Movies', type: 'movie' },
      { key: '2', title: 'Shows', type: 'show' },
    ]);
    settingsService.updateSettings.mockResolvedValue({
      plex: {
        baseUrl: 'http://plex:32400',
        librarySelection: { excludedSectionKeys: ['2'] },
      },
    });
    const mockedTx = [
      { count: 11 },
      { count: 7 },
      { count: 5 },
      { count: 3 },
    ];
    prisma.$transaction.mockResolvedValue(mockedTx);
    plexServer.listCollectionsForSectionKey.mockResolvedValue([
      { ratingKey: '101', title: 'Inspired by your Immaculate Taste (Admin)' },
      { ratingKey: '102', title: 'Some other collection' },
    ]);
    plexServer.deleteCollection.mockResolvedValue(undefined);

    const res = await controller.savePlexLibraries(
      { user: { id: 'u1' } } as never,
      { selectedSectionKeys: ['1'] },
    );

    expect(prisma.immaculateTasteMovieLibrary.deleteMany).toHaveBeenCalledWith({
      where: { librarySectionKey: { in: ['2'] } },
    });
    expect(prisma.immaculateTasteShowLibrary.deleteMany).toHaveBeenCalledWith({
      where: { librarySectionKey: { in: ['2'] } },
    });
    expect(prisma.watchedMovieRecommendationLibrary.deleteMany).toHaveBeenCalledWith({
      where: { librarySectionKey: { in: ['2'] } },
    });
    expect(prisma.watchedShowRecommendationLibrary.deleteMany).toHaveBeenCalledWith({
      where: { librarySectionKey: { in: ['2'] } },
    });
    expect(plexServer.listCollectionsForSectionKey).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'token',
      librarySectionKey: '2',
      take: 500,
    });
    expect(plexServer.deleteCollection).toHaveBeenCalledWith({
      baseUrl: 'http://plex:32400',
      token: 'token',
      collectionRatingKey: '101',
    });
    expect(res.selectedSectionKeys).toEqual(['1']);
    expect((res as Record<string, unknown>)['cleanup']).toBeTruthy();
  });

  it('POST /test/overseerr validates with saved credentials', async () => {
    const { controller, settingsService, overseerr } = makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        overseerr: { baseUrl: 'http://localhost:5055' },
      },
      secrets: {
        overseerr: { apiKey: 'secret' },
      },
    });
    overseerr.testConnection.mockResolvedValue({ ok: true });

    const res = await controller.testSaved(
      { user: { id: 'u1' } } as never,
      'overseerr',
      {},
    );

    expect(overseerr.testConnection).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:5055',
      apiKey: 'secret',
    });
    expect(res).toEqual({ ok: true, result: { ok: true } });
  });
});
