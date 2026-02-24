import { BadRequestException } from '@nestjs/common';
import { IntegrationsController } from '../../integrations/integrations.controller';

type Scenario = {
  id: 'plex' | 'radarr' | 'sonarr' | 'tmdb' | 'overseerr' | 'google' | 'openai';
  secretField: 'token' | 'apiKey';
  body: Record<string, unknown>;
  assertCalled: (deps: ReturnType<typeof makeController>, secret: string) => void;
};

const scenarios: Scenario[] = [
  {
    id: 'plex',
    secretField: 'token',
    body: { baseUrl: 'http://plex.local' },
    assertCalled: (deps, secret) => {
      expect(deps.plexServer.getMachineIdentifier).toHaveBeenCalledWith({
        baseUrl: 'http://plex.local',
        token: secret,
      });
    },
  },
  {
    id: 'radarr',
    secretField: 'apiKey',
    body: { baseUrl: 'http://radarr.local' },
    assertCalled: (deps, secret) => {
      expect(deps.radarr.testConnection).toHaveBeenCalledWith({
        baseUrl: 'http://radarr.local',
        apiKey: secret,
      });
    },
  },
  {
    id: 'sonarr',
    secretField: 'apiKey',
    body: { baseUrl: 'http://sonarr.local' },
    assertCalled: (deps, secret) => {
      expect(deps.sonarr.testConnection).toHaveBeenCalledWith({
        baseUrl: 'http://sonarr.local',
        apiKey: secret,
      });
    },
  },
  {
    id: 'tmdb',
    secretField: 'apiKey',
    body: {},
    assertCalled: (deps, secret) => {
      expect(deps.tmdb.testConnection).toHaveBeenCalledWith({ apiKey: secret });
    },
  },
  {
    id: 'overseerr',
    secretField: 'apiKey',
    body: { baseUrl: 'http://overseerr.local' },
    assertCalled: (deps, secret) => {
      expect(deps.overseerr.testConnection).toHaveBeenCalledWith({
        baseUrl: 'http://overseerr.local',
        apiKey: secret,
      });
    },
  },
  {
    id: 'google',
    secretField: 'apiKey',
    body: { cseId: 'cse-1' },
    assertCalled: (deps, secret) => {
      expect(deps.google.testConnection).toHaveBeenCalledWith({
        apiKey: secret,
        cseId: 'cse-1',
        query: 'tautulli curated plex',
        numResults: 3,
      });
    },
  },
  {
    id: 'openai',
    secretField: 'apiKey',
    body: {},
    assertCalled: (deps, secret) => {
      expect(deps.openai.testConnection).toHaveBeenCalledWith({ apiKey: secret });
    },
  },
];

function makeController() {
  const prisma = {
    $transaction: jest.fn(),
    immaculateTasteMovieLibrary: { deleteMany: jest.fn() },
    immaculateTasteShowLibrary: { deleteMany: jest.fn() },
    watchedMovieRecommendationLibrary: { deleteMany: jest.fn() },
    watchedShowRecommendationLibrary: { deleteMany: jest.fn() },
  };

  const settingsService = {
    getInternalSettings: jest.fn().mockResolvedValue({
      settings: {
        plex: { baseUrl: 'http://plex.saved' },
        radarr: { baseUrl: 'http://radarr.saved' },
        sonarr: { baseUrl: 'http://sonarr.saved' },
        overseerr: { baseUrl: 'http://overseerr.saved' },
        google: { searchEngineId: 'saved-cse' },
      },
      secrets: {
        plex: { token: 'saved-plex' },
        radarr: { apiKey: 'saved-radarr' },
        sonarr: { apiKey: 'saved-sonarr' },
        tmdb: { apiKey: 'saved-tmdb' },
        overseerr: { apiKey: 'saved-overseerr' },
        google: { apiKey: 'saved-google' },
        openai: { apiKey: 'saved-openai' },
      },
    }),
    updateSettings: jest.fn(),
    resolveServiceSecretInput: jest
      .fn()
      .mockResolvedValue({ value: '', source: 'none' }),
    readServiceSecret: jest.fn().mockReturnValue(''),
  };

  const plex = { listSharedUsersForServer: jest.fn() };
  const plexServer = {
    getSections: jest.fn(),
    getMachineIdentifier: jest.fn().mockResolvedValue('m1'),
    listCollectionsForSectionKey: jest.fn(),
    deleteCollection: jest.fn(),
  };
  const plexUsers = {
    ensureAdminPlexUser: jest.fn(),
    getOrCreateByPlexAccount: jest.fn(),
  };
  const radarr = { testConnection: jest.fn().mockResolvedValue({ ok: true }) };
  const sonarr = { testConnection: jest.fn().mockResolvedValue({ ok: true }) };
  const tmdb = { testConnection: jest.fn().mockResolvedValue({ ok: true }) };
  const google = { testConnection: jest.fn().mockResolvedValue({ ok: true }) };
  const openai = { testConnection: jest.fn().mockResolvedValue({ ok: true }) };
  const overseerr = { testConnection: jest.fn().mockResolvedValue({ ok: true }) };

  const controller = new IntegrationsController(
    prisma as never,
    settingsService as never,
    plex as never,
    plexServer as never,
    plexUsers as never,
    radarr as never,
    sonarr as never,
    tmdb as never,
    google as never,
    openai as never,
    overseerr as never,
  );

  return {
    controller,
    settingsService,
    plexServer,
    radarr,
    sonarr,
    tmdb,
    google,
    openai,
    overseerr,
  };
}

describe('security/integrations secret transport', () => {
  it.each(scenarios)(
    'accepts encrypted envelopes for %s tests',
    async (scenario) => {
      const deps = makeController();
      const req = { user: { id: 'u1' } };
      const secret = `env-${scenario.id}`;
      deps.settingsService.resolveServiceSecretInput.mockResolvedValue({
        value: secret,
        source: 'envelope',
      });

      await deps.controller.testSaved(req as never, scenario.id, {
        ...scenario.body,
        ...(scenario.secretField === 'token'
          ? { tokenEnvelope: { ciphertext: 'x' } }
          : { apiKeyEnvelope: { ciphertext: 'x' } }),
      });

      expect(deps.settingsService.resolveServiceSecretInput).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          service: scenario.id,
          secretField: scenario.secretField,
        }),
      );
      scenario.assertCalled(deps, secret);
    },
  );

  it.each(scenarios)(
    'accepts secretRef payloads for %s tests',
    async (scenario) => {
      const deps = makeController();
      const req = { user: { id: 'u1' } };
      const secret = `ref-${scenario.id}`;
      deps.settingsService.resolveServiceSecretInput.mockResolvedValue({
        value: secret,
        source: 'secretRef',
      });

      await deps.controller.testSaved(req as never, scenario.id, {
        ...scenario.body,
        secretRef: 'sr1.fake',
      });

      expect(deps.settingsService.resolveServiceSecretInput).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          service: scenario.id,
          secretField: scenario.secretField,
        }),
      );
      scenario.assertCalled(deps, secret);
    },
  );

  it.each(scenarios)(
    'rejects plaintext secrets for %s tests in strict mode',
    async (scenario) => {
      const deps = makeController();
      const req = { user: { id: 'u1' } };
      deps.settingsService.resolveServiceSecretInput.mockRejectedValue(
        new BadRequestException(
          'Plaintext secret transport is disabled; use encrypted envelope payloads.',
        ),
      );

      await expect(
        deps.controller.testSaved(req as never, scenario.id, {
          ...scenario.body,
          ...(scenario.secretField === 'token'
            ? { token: 'plaintext-token' }
            : { apiKey: 'plaintext-key' }),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
