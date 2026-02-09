import { BadRequestException } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';

describe('IntegrationsController plex libraries', () => {
  const makeController = () => {
    const settingsService = {
      getInternalSettings: jest.fn(),
      updateSettings: jest.fn(),
    };
    const plexServer = {
      getSections: jest.fn(),
    };
    const controller = new IntegrationsController(
      settingsService as never,
      plexServer as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { controller, settingsService, plexServer };
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
});

