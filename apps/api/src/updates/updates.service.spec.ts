import { UpdatesService } from './updates.service';

type MockResponseInput = {
  status: number;
  text?: string;
  json?: unknown;
};

function mockResponse(input: MockResponseInput): Response {
  const { status } = input;
  const textBody = input.text ?? '';
  const jsonBody = input.json ?? {};

  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(textBody),
    json: jest.fn().mockResolvedValue(jsonBody),
  } as unknown as Response;
}

describe('UpdatesService', () => {
  const originalEnv = {
    APP_IMAGE_VERSION: process.env.APP_IMAGE_VERSION,
    APP_VERSION: process.env.APP_VERSION,
    ALLOW_APP_VERSION_OVERRIDE: process.env.ALLOW_APP_VERSION_OVERRIDE,
    UPDATE_CHECK_ENABLED: process.env.UPDATE_CHECK_ENABLED,
    UPDATE_CHECK_REPO: process.env.UPDATE_CHECK_REPO,
    UPDATE_CHECK_TTL_MS: process.env.UPDATE_CHECK_TTL_MS,
    UPDATE_CHECK_GITHUB_TOKEN: process.env.UPDATE_CHECK_GITHUB_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  };

  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();

  let service: UpdatesService;

  function restoreEnvValue(
    key: keyof typeof originalEnv,
    value: string | undefined,
  ) {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  }

  function mockStableRelease(version: string, htmlUrl?: string) {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        json: {
          tag_name: `v${version}`,
          html_url:
            htmlUrl ??
            `https://github.com/ohmz/Immaculaterr/releases/tag/v${version}`,
        },
      }),
    );
  }

  function mockBetaTags(tags: string[]) {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        json: tags.map((tag) => ({
          ref: `refs/tags/${tag}`,
        })),
      }),
    );
  }

  beforeEach(() => {
    fetchMock.mockReset();
    (global as { fetch: typeof fetch }).fetch = fetchMock as never;

    process.env.UPDATE_CHECK_ENABLED = 'true';
    process.env.UPDATE_CHECK_REPO = 'ohmz/Immaculaterr';
    process.env.UPDATE_CHECK_TTL_MS = '60000';
    delete process.env.APP_IMAGE_VERSION;
    delete process.env.UPDATE_CHECK_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.APP_VERSION;
    delete process.env.ALLOW_APP_VERSION_OVERRIDE;

    service = new UpdatesService();
  });

  afterEach(() => {
    restoreEnvValue('APP_IMAGE_VERSION', originalEnv.APP_IMAGE_VERSION);
    restoreEnvValue('APP_VERSION', originalEnv.APP_VERSION);
    restoreEnvValue(
      'ALLOW_APP_VERSION_OVERRIDE',
      originalEnv.ALLOW_APP_VERSION_OVERRIDE,
    );
    restoreEnvValue('UPDATE_CHECK_ENABLED', originalEnv.UPDATE_CHECK_ENABLED);
    restoreEnvValue('UPDATE_CHECK_REPO', originalEnv.UPDATE_CHECK_REPO);
    restoreEnvValue('UPDATE_CHECK_TTL_MS', originalEnv.UPDATE_CHECK_TTL_MS);
    restoreEnvValue(
      'UPDATE_CHECK_GITHUB_TOKEN',
      originalEnv.UPDATE_CHECK_GITHUB_TOKEN,
    );
    restoreEnvValue('GITHUB_TOKEN', originalEnv.GITHUB_TOKEN);
    jest.restoreAllMocks();
  });

  it('notifies beta installs when a stable release for the same core version exists', async () => {
    process.env.APP_IMAGE_VERSION = '1.7.8-beta';
    mockStableRelease('1.7.8');
    mockBetaTags(['v1.7.8-beta-2']);

    await expect(service.getUpdates()).resolves.toEqual(
      expect.objectContaining({
        currentVersion: '1.7.8-beta',
        latestVersion: '1.7.8',
        latestUrl: 'https://github.com/ohmz/Immaculaterr/releases/tag/v1.7.8',
        updateAvailable: true,
        error: null,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      '/git/matching-refs/tags/v',
    );
  });

  it('notifies beta installs when a numbered beta tag for the same core version exists', async () => {
    process.env.APP_IMAGE_VERSION = '1.7.8-beta';
    mockStableRelease('1.7.7');
    mockBetaTags(['v1.7.8-beta-2']);

    await expect(service.getUpdates()).resolves.toEqual(
      expect.objectContaining({
        currentVersion: '1.7.8-beta',
        latestVersion: '1.7.8-beta-2',
        latestUrl: 'https://github.com/ohmz/Immaculaterr/tree/v1.7.8-beta-2',
        updateAvailable: true,
        error: null,
      }),
    );
  });

  it('notifies beta installs when a newer beta base version exists', async () => {
    process.env.APP_IMAGE_VERSION = '1.7.7-beta';
    mockStableRelease('1.7.7');
    mockBetaTags(['v1.7.8-beta']);

    await expect(service.getUpdates()).resolves.toEqual(
      expect.objectContaining({
        currentVersion: '1.7.7-beta',
        latestVersion: '1.7.8-beta',
        latestUrl: 'https://github.com/ohmz/Immaculaterr/tree/v1.7.8-beta',
        updateAvailable: true,
        error: null,
      }),
    );
  });

  it('ignores beta tags entirely for stable installs', async () => {
    process.env.APP_IMAGE_VERSION = '1.7.8';
    mockStableRelease('1.7.8');

    await expect(service.getUpdates()).resolves.toEqual(
      expect.objectContaining({
        currentVersion: '1.7.8',
        latestVersion: '1.7.8',
        updateAvailable: false,
        error: null,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/releases/latest');
  });

  it('notifies stable installs only when a newer stable release exists', async () => {
    process.env.APP_IMAGE_VERSION = '1.7.8';
    mockStableRelease('1.7.9');

    await expect(service.getUpdates()).resolves.toEqual(
      expect.objectContaining({
        currentVersion: '1.7.8',
        latestVersion: '1.7.9',
        latestUrl: 'https://github.com/ohmz/Immaculaterr/releases/tag/v1.7.9',
        updateAvailable: true,
        error: null,
      }),
    );
  });

  it('ignores malformed or non-matching beta tags safely', async () => {
    process.env.APP_IMAGE_VERSION = '1.7.8-beta';
    mockStableRelease('1.7.7');
    mockBetaTags([
      'v1.7.8-beta-foo',
      'v1.7.8-beta-0',
      'v1.7.8-beta-1',
      'v1.7.8-rc1',
      'v1.7.7-beta-9',
      'v1.7.8-beta-2',
    ]);

    await expect(service.getUpdates()).resolves.toEqual(
      expect.objectContaining({
        currentVersion: '1.7.8-beta',
        latestVersion: '1.7.8-beta-2',
        latestUrl: 'https://github.com/ohmz/Immaculaterr/tree/v1.7.8-beta-2',
        updateAvailable: true,
        error: null,
      }),
    );
  });

  it('keeps stable release checks working when beta tag lookup fails', async () => {
    process.env.APP_IMAGE_VERSION = '1.7.7-beta';
    mockStableRelease('1.7.8');
    fetchMock.mockRejectedValueOnce(new Error('beta tag lookup failed'));

    await expect(service.getUpdates()).resolves.toEqual(
      expect.objectContaining({
        currentVersion: '1.7.7-beta',
        latestVersion: '1.7.8',
        latestUrl: 'https://github.com/ohmz/Immaculaterr/releases/tag/v1.7.8',
        updateAvailable: true,
        error: null,
      }),
    );
  });
});
