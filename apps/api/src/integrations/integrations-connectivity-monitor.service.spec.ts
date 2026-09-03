import { IntegrationsConnectivityMonitorService } from './integrations-connectivity-monitor.service';

function mockResponse(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('IntegrationsConnectivityMonitorService', () => {
  const fetchMock = jest.fn();
  const prisma = {
    user: { findFirst: jest.fn() },
  };
  const settingsService = {
    getInternalSettings: jest.fn(),
  };

  let service: IntegrationsConnectivityMonitorService;

  beforeEach(() => {
    fetchMock.mockReset();
    (global as { fetch: typeof fetch }).fetch = fetchMock as never;
    prisma.user.findFirst.mockReset().mockResolvedValue({ id: 'user-1' });
    settingsService.getInternalSettings.mockReset().mockResolvedValue({
      settings: {},
      secrets: { tmdb: { apiKey: 'test-key' } },
    });
    service = new IntegrationsConnectivityMonitorService(
      prisma as never,
      settingsService as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries once on a transient TMDB failure within a single poll instead of failing immediately', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(503, 'temporarily unavailable'))
      .mockResolvedValueOnce(mockResponse(200, '{}'));

    await expect(service.poll()).resolves.toBeUndefined();

    // Only TMDB is configured in this test (the other integrations are
    // "not_configured" and short-circuit before calling fetch), so both
    // fetch calls belong to the single TMDB probe: the transient 503 and
    // the fetchWithTransientRetry-driven retry that follows it.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a clean success', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, '{}'));

    await service.poll();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
