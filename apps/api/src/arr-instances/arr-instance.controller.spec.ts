import { ArrInstanceController } from './arr-instance.controller';

type ResolvedInstance = {
  id: string;
  type: 'radarr' | 'sonarr';
  name: string;
  isPrimary: boolean;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  rootFolderPath: string | null;
  qualityProfileId: number | null;
  tagId: number | null;
};

function buildResolvedInstance(
  overrides: Partial<ResolvedInstance> = {},
): ResolvedInstance {
  return {
    id: 'arr-1',
    type: 'radarr',
    name: 'Additional Radarr',
    isPrimary: false,
    enabled: true,
    baseUrl: 'http://localhost:7878',
    apiKey: 'radarr-key',
    rootFolderPath: null,
    qualityProfileId: null,
    tagId: null,
    ...overrides,
  };
}

function makeController() {
  const arrInstances = {
    list: jest.fn(),
    create: jest.fn(),
    getOwnedDbInstance: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn(),
    inferTypeForInstanceId: jest.fn().mockResolvedValue('radarr'),
    resolveInstance: jest.fn().mockResolvedValue(buildResolvedInstance()),
  };
  const settingsService = {
    getInternalSettings: jest.fn().mockResolvedValue({
      settings: {},
      secrets: {},
    }),
    resolveServiceSecretInput: jest.fn(),
    updateSettings: jest.fn().mockResolvedValue(undefined),
  };
  const radarr = {
    testConnection: jest.fn().mockResolvedValue({ ok: true }),
    listRootFolders: jest.fn().mockResolvedValue([{ path: '/data/movies' }]),
    listQualityProfiles: jest.fn().mockResolvedValue([{ name: 'Any' }]),
    listTags: jest.fn().mockResolvedValue([{ label: 'No tag' }]),
  };
  const sonarr = {
    testConnection: jest.fn().mockResolvedValue({ ok: true }),
    listRootFolders: jest.fn().mockResolvedValue([{ path: '/data/tv' }]),
    listQualityProfiles: jest.fn().mockResolvedValue([{ name: 'Any' }]),
    listTags: jest.fn().mockResolvedValue([{ label: 'No tag' }]),
  };

  const controller = new ArrInstanceController(
    arrInstances as never,
    settingsService as never,
    radarr as never,
    sonarr as never,
  );

  return {
    controller,
    arrInstances,
    settingsService,
    radarr,
    sonarr,
  };
}

describe('ArrInstanceController localhost fallback', () => {
  it('falls back to container host for additional Radarr instance tests and persists fallback baseUrl', async () => {
    const deps = makeController();
    deps.arrInstances.resolveInstance.mockResolvedValue(
      buildResolvedInstance({
        id: 'arr-radarr-1',
        isPrimary: false,
        baseUrl: 'http://localhost:7878',
      }),
    );
    deps.radarr.testConnection
      .mockRejectedValueOnce(new Error('Radarr test failed: fetch failed'))
      .mockResolvedValueOnce({ ok: true });

    const req = { user: { id: 'user-1' } };
    const response = await deps.controller.test(
      req as never,
      'arr-radarr-1',
      'radarr',
    );

    expect(deps.radarr.testConnection).toHaveBeenNthCalledWith(1, {
      baseUrl: 'http://localhost:7878',
      apiKey: 'radarr-key',
    });
    expect(deps.radarr.testConnection).toHaveBeenNthCalledWith(2, {
      baseUrl: 'http://172.17.0.1:7878',
      apiKey: 'radarr-key',
    });
    expect(deps.arrInstances.update).toHaveBeenCalledWith(
      'user-1',
      'arr-radarr-1',
      {
        baseUrl: 'http://172.17.0.1:7878',
      },
    );
    expect(deps.settingsService.updateSettings).not.toHaveBeenCalled();
    expect(response.instance.baseUrl).toBe('http://172.17.0.1:7878');
  });

  it('falls back for primary Sonarr instance tests and persists fallback in settings', async () => {
    const deps = makeController();
    deps.arrInstances.resolveInstance.mockResolvedValue(
      buildResolvedInstance({
        id: 'primary-sonarr',
        type: 'sonarr',
        isPrimary: true,
        baseUrl: 'http://localhost:8989',
        apiKey: 'sonarr-key',
      }),
    );
    deps.sonarr.testConnection
      .mockRejectedValueOnce(new Error('Sonarr test failed: fetch failed'))
      .mockResolvedValueOnce({ ok: true });

    const req = { user: { id: 'user-1' } };
    await deps.controller.test(req as never, 'primary-sonarr', 'sonarr');

    expect(deps.sonarr.testConnection).toHaveBeenNthCalledWith(1, {
      baseUrl: 'http://localhost:8989',
      apiKey: 'sonarr-key',
    });
    expect(deps.sonarr.testConnection).toHaveBeenNthCalledWith(2, {
      baseUrl: 'http://172.17.0.1:8989',
      apiKey: 'sonarr-key',
    });
    expect(deps.settingsService.updateSettings).toHaveBeenCalledWith('user-1', {
      sonarr: { baseUrl: 'http://172.17.0.1:8989' },
    });
    expect(deps.arrInstances.update).not.toHaveBeenCalled();
  });

  it('does not retry fallback on auth failures', async () => {
    const deps = makeController();
    deps.arrInstances.resolveInstance.mockResolvedValue(
      buildResolvedInstance({
        id: 'arr-radarr-1',
        isPrimary: false,
        baseUrl: 'http://localhost:7878',
      }),
    );
    deps.radarr.testConnection.mockRejectedValueOnce(
      new Error('Radarr test failed: HTTP 401 Unauthorized'),
    );

    const req = { user: { id: 'user-1' } };
    await expect(
      deps.controller.test(req as never, 'arr-radarr-1', 'radarr'),
    ).rejects.toThrow('Radarr test failed: HTTP 401 Unauthorized');

    expect(deps.radarr.testConnection).toHaveBeenCalledTimes(1);
    expect(deps.arrInstances.update).not.toHaveBeenCalled();
    expect(deps.settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('falls back when loading ARR options for additional instance', async () => {
    const deps = makeController();
    deps.arrInstances.resolveInstance.mockResolvedValue(
      buildResolvedInstance({
        id: 'arr-radarr-1',
        isPrimary: false,
        baseUrl: 'http://localhost:7878',
      }),
    );
    deps.radarr.listRootFolders
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce([{ path: '/data/movies' }]);
    deps.radarr.listQualityProfiles
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce([{ name: 'Any' }]);
    deps.radarr.listTags
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce([{ label: 'No tag' }]);

    const req = { user: { id: 'user-1' } };
    const response = await deps.controller.options(
      req as never,
      'arr-radarr-1',
      'radarr',
    );

    expect(deps.arrInstances.update).toHaveBeenCalledWith(
      'user-1',
      'arr-radarr-1',
      {
        baseUrl: 'http://172.17.0.1:7878',
      },
    );
    expect(response.rootFolders).toEqual([{ path: '/data/movies' }]);
    expect(response.qualityProfiles).toEqual([{ name: 'Any' }]);
    expect(response.tags).toEqual([{ label: 'No tag' }]);
  });
});
