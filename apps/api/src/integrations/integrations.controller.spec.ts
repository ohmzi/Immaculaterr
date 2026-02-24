import { BadRequestException } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';

describe('IntegrationsController plex libraries', () => {
  const makeController = () => {
    const readNestedString = (
      input: Record<string, unknown>,
      path: string,
    ): string => {
      const parts = path.split('.');
      let current: unknown = input;
      for (const part of parts) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
          return '';
        }
        current = (current as Record<string, unknown>)[part];
      }
      return typeof current === 'string' ? current : '';
    };

    const readServiceSecret = (
      service: string,
      secrets: Record<string, unknown>,
    ): string => {
      const secretPathByService: Record<string, string> = {
        plex: 'plex.token',
        radarr: 'radarr.apiKey',
        sonarr: 'sonarr.apiKey',
        tmdb: 'tmdb.apiKey',
        overseerr: 'overseerr.apiKey',
        google: 'google.apiKey',
        openai: 'openai.apiKey',
      };
      const path = secretPathByService[service];
      if (!path) return '';
      const nestedValue = readNestedString(secrets, path);
      if (nestedValue) return nestedValue;
      return service === 'plex' ? readNestedString(secrets, 'plexToken') : '';
    };

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
      resolveServiceSecretInput: jest
        .fn()
        .mockResolvedValue({ value: '', source: 'none' }),
      readServiceSecret: jest.fn(readServiceSecret),
    };
    const plex = {
      listSharedUsersForServer: jest.fn(),
    };
    const plexServer = {
      getSections: jest.fn(),
      getMachineIdentifier: jest.fn(),
      listCollectionsForSectionKey: jest.fn(),
      deleteCollection: jest.fn(),
    };
    const plexUsers = {
      ensureAdminPlexUser: jest.fn(),
      getOrCreateByPlexAccount: jest.fn(),
    };
    const overseerr = {
      testConnection: jest.fn(),
    };
    const controller = new IntegrationsController(
      prisma as never,
      settingsService as never,
      plex as never,
      plexServer as never,
      plexUsers as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      overseerr as never,
    );
    return {
      controller,
      prisma,
      settingsService,
      plex,
      plexServer,
      plexUsers,
      overseerr,
    };
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

  it('GET /plex/monitoring-users returns selected state', async () => {
    const { controller, settingsService, plex, plexServer, plexUsers } =
      makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        plex: {
          baseUrl: 'http://plex:32400',
          userMonitoring: {
            excludedPlexUserIds: ['plex-user-2'],
          },
        },
      },
      secrets: {
        plex: { token: 'token' },
      },
    });
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'plex-admin',
      plexAccountId: 1,
      plexAccountTitle: 'Admin',
      isAdmin: true,
    });
    plex.listSharedUsersForServer.mockResolvedValue([
      {
        plexAccountId: 2,
        plexAccountTitle: 'Alice',
        username: 'Alice',
        email: null,
      },
      {
        plexAccountId: 3,
        plexAccountTitle: 'Bob',
        username: 'Bob',
        email: null,
      },
    ]);
    plexUsers.getOrCreateByPlexAccount
      .mockResolvedValueOnce({
        id: 'plex-user-2',
        plexAccountId: 2,
        plexAccountTitle: 'Alice',
        isAdmin: false,
      })
      .mockResolvedValueOnce({
        id: 'plex-user-3',
        plexAccountId: 3,
        plexAccountTitle: 'Bob',
        isAdmin: false,
      });

    const res = await controller.plexMonitoringUsers({
      user: { id: 'u1' },
    } as never);

    expect(res.ok).toBe(true);
    expect(res.defaultEnabled).toBe(true);
    expect(res.autoIncludeNewUsers).toBe(true);
    expect(res.selectedPlexUserIds).toEqual(['plex-admin', 'plex-user-3']);
    expect(res.excludedPlexUserIds).toEqual(['plex-user-2']);
  });

  it('PUT /plex/monitoring-users rejects unknown ids', async () => {
    const { controller, settingsService, plex, plexServer, plexUsers } =
      makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex:32400' },
      },
      secrets: { plex: { token: 'token' } },
    });
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'plex-admin',
      plexAccountId: 1,
      plexAccountTitle: 'Admin',
      isAdmin: true,
    });
    plex.listSharedUsersForServer.mockResolvedValue([]);

    await expect(
      controller.savePlexMonitoringUsers(
        { user: { id: 'u1' } } as never,
        { selectedPlexUserIds: ['missing'] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('PUT /plex/monitoring-users persists excluded complement', async () => {
    const { controller, settingsService, plex, plexServer, plexUsers } =
      makeController();
    settingsService.getInternalSettings.mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex:32400' },
      },
      secrets: { plex: { token: 'token' } },
    });
    plexServer.getMachineIdentifier.mockResolvedValue('machine-1');
    plexUsers.ensureAdminPlexUser.mockResolvedValue({
      id: 'plex-admin',
      plexAccountId: 1,
      plexAccountTitle: 'Admin',
      isAdmin: true,
    });
    plex.listSharedUsersForServer.mockResolvedValue([
      {
        plexAccountId: 2,
        plexAccountTitle: 'Alice',
        username: 'Alice',
        email: null,
      },
    ]);
    plexUsers.getOrCreateByPlexAccount.mockResolvedValue({
      id: 'plex-user-2',
      plexAccountId: 2,
      plexAccountTitle: 'Alice',
      isAdmin: false,
    });
    settingsService.updateSettings.mockResolvedValue({
      plex: {
        baseUrl: 'http://plex:32400',
        userMonitoring: { excludedPlexUserIds: ['plex-user-2'] },
      },
    });

    const res = await controller.savePlexMonitoringUsers(
      { user: { id: 'u1' } } as never,
      { selectedPlexUserIds: ['plex-admin'] },
    );

    expect(settingsService.updateSettings).toHaveBeenCalledWith('u1', {
      plex: {
        userMonitoring: {
          excludedPlexUserIds: ['plex-user-2'],
        },
      },
    });
    expect(res.selectedPlexUserIds).toEqual(['plex-admin']);
    expect(res.excludedPlexUserIds).toEqual(['plex-user-2']);
  });
});
