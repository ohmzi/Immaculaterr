import { BadRequestException } from '@nestjs/common';
import { PlexController } from './plex.controller';

function makeController() {
  const plexService = {
    createPin: jest.fn(),
    checkPin: jest.fn(),
    whoami: jest.fn(),
  };
  const plexServerService = {
    getSections: jest.fn(),
    getMachineIdentifier: jest.fn(),
  };
  const plexAnalytics = {
    getLibraryGrowth: jest.fn(),
    getLibraryGrowthVersion: jest.fn(),
  };
  const settingsService = {
    updateSecrets: jest.fn(),
    resolveServiceSecretInput: jest.fn(),
  };

  const controller = new PlexController(
    plexService as never,
    plexServerService as never,
    plexAnalytics as never,
    settingsService as never,
  );

  return {
    controller,
    plexService,
    settingsService,
  };
}

describe('PlexController.checkPin', () => {
  it('rejects invalid pin ids', async () => {
    const { controller } = makeController();
    const req = { user: { id: 'u1' } };

    await expect(controller.checkPin(req as never, '0')).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.checkPin(req as never, 'bad')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('returns authTokenStored=false when the pin is not authorized yet', async () => {
    const { controller, plexService, settingsService } = makeController();
    const req = { user: { id: 'u1' } };
    plexService.checkPin.mockResolvedValue({
      id: 123,
      authToken: null,
      expiresAt: null,
      suggestedBaseUrl: null,
      suggestedBaseUrls: [],
    });

    await expect(controller.checkPin(req as never, '123')).resolves.toEqual({
      id: 123,
      authToken: null,
      expiresAt: null,
      suggestedBaseUrl: null,
      suggestedBaseUrls: [],
      authTokenStored: false,
    });
    expect(settingsService.updateSecrets).not.toHaveBeenCalled();
  });

  it('does not persist OAuth token without poll header intent', async () => {
    const { controller, plexService, settingsService } = makeController();
    const req = { user: { id: 'u1' } };
    const authToken = 'plex-auth-token';
    plexService.checkPin.mockResolvedValue({
      id: 444,
      authToken,
      expiresAt: null,
      suggestedBaseUrl: null,
      suggestedBaseUrls: [],
    });

    await expect(controller.checkPin(req as never, '444')).resolves.toEqual({
      id: 444,
      authToken,
      expiresAt: null,
      suggestedBaseUrl: null,
      suggestedBaseUrls: [],
      authTokenStored: false,
    });
    expect(settingsService.updateSecrets).not.toHaveBeenCalled();
  });

  it('persists OAuth token and returns authTokenStored=true', async () => {
    const { controller, plexService, settingsService } = makeController();
    const req = { user: { id: 'u1' } };
    const authToken = 'plex-auth-token';
    plexService.checkPin.mockResolvedValue({
      id: 456,
      authToken,
      expiresAt: null,
      suggestedBaseUrl: 'http://plex.local:32400',
      suggestedBaseUrls: ['http://plex.local:32400'],
    });

    await expect(
      controller.checkPin(req as never, '456', '1'),
    ).resolves.toEqual({
      id: 456,
      authToken,
      expiresAt: null,
      suggestedBaseUrl: 'http://plex.local:32400',
      suggestedBaseUrls: ['http://plex.local:32400'],
      authTokenStored: true,
    });
    expect(settingsService.updateSecrets).toHaveBeenCalledWith('u1', {
      plex: { token: authToken },
    });
  });

  it('keeps polling response usable when token persistence fails', async () => {
    const { controller, plexService, settingsService } = makeController();
    const req = { user: { id: 'u1' } };
    const authToken = 'plex-auth-token';
    plexService.checkPin.mockResolvedValue({
      id: 789,
      authToken,
      expiresAt: null,
      suggestedBaseUrl: null,
      suggestedBaseUrls: [],
    });
    settingsService.updateSecrets.mockRejectedValue(
      new Error('db unavailable'),
    );

    await expect(
      controller.checkPin(req as never, '789', '1'),
    ).resolves.toEqual({
      id: 789,
      authToken,
      expiresAt: null,
      suggestedBaseUrl: null,
      suggestedBaseUrls: [],
      authTokenStored: false,
    });
  });
});
