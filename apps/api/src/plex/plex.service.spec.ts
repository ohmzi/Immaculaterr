import { PlexService } from './plex.service';

type MockResponseParams = {
  ok: boolean;
  status: number;
  body: string;
  contentType?: string;
};

type MockJsonResponseParams = {
  ok: boolean;
  status: number;
  body: unknown;
};

function mockResponse(params: MockResponseParams): Response {
  return {
    ok: params.ok,
    status: params.status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? (params.contentType ?? 'application/json')
          : null,
    },
    text: jest.fn().mockResolvedValue(params.body),
  } as unknown as Response;
}

function mockJsonResponse(params: MockJsonResponseParams): Response {
  return {
    ok: params.ok,
    status: params.status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: jest.fn().mockResolvedValue(params.body),
    text: jest.fn().mockResolvedValue(JSON.stringify(params.body)),
  } as unknown as Response;
}

describe('PlexService.checkPin', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns auth token with auto-detected preferred server URL when authorized', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          status: 200,
          body: {
            id: 999,
            authToken: 'plex-token',
            expiresAt: '2026-03-01T00:00:00.000Z',
          },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          body: JSON.stringify({
            MediaContainer: {
              Device: [
                {
                  provides: 'server,player',
                  owned: true,
                  publicAddressMatches: true,
                  Connection: [
                    {
                      uri: 'https://relay.plex.example',
                      local: false,
                      relay: true,
                    },
                    {
                      uri: 'http://192.168.1.55:32400',
                      local: true,
                      relay: false,
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );

    const service = new PlexService();
    const result = await service.checkPin(999);

    expect(result).toEqual({
      id: 999,
      authToken: 'plex-token',
      expiresAt: '2026-03-01T00:00:00.000Z',
      suggestedBaseUrl: 'http://192.168.1.55:32400',
      suggestedBaseUrls: [
        'http://192.168.1.55:32400',
        'https://relay.plex.example',
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns pin status without URL suggestions when auth token is missing', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        ok: true,
        status: 200,
        body: {
          id: 111,
          authToken: null,
          expiresAt: '2026-03-01T00:00:00.000Z',
        },
      }),
    );

    const service = new PlexService();
    const result = await service.checkPin(111);

    expect(result).toEqual({
      id: 111,
      authToken: null,
      expiresAt: '2026-03-01T00:00:00.000Z',
      suggestedBaseUrl: null,
      suggestedBaseUrls: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps checkPin successful when server-url lookup fails', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          status: 200,
          body: {
            id: 222,
            authToken: 'plex-token',
            expiresAt: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          body: 'error',
          contentType: 'text/plain',
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          body: 'error',
          contentType: 'text/plain',
        }),
      );

    const service = new PlexService();
    const result = await service.checkPin(222);

    expect(result).toEqual({
      id: 222,
      authToken: 'plex-token',
      expiresAt: null,
      suggestedBaseUrl: null,
      suggestedBaseUrls: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('PlexService.listSharedUsersForServer', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('merges shared users with Plex Home users and prefers friendlyName', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          body: JSON.stringify({
            users: [{ userID: 11, friendlyName: 'Roommate' }],
          }),
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          body: JSON.stringify({
            users: [{ id: 22, friendlyName: 'Kid Profile' }],
          }),
        }),
      );

    const service = new PlexService();
    const users = await service.listSharedUsersForServer({
      plexToken: 'token',
      machineIdentifier: 'machine-id',
    });

    expect(users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plexAccountId: 11,
          plexAccountTitle: 'Roommate',
        }),
        expect.objectContaining({
          plexAccountId: 22,
          plexAccountTitle: 'Kid Profile',
        }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses nested user identity instead of shared-server metadata labels', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          body: JSON.stringify({
            users: [
              {
                id: 777,
                title: 'Omar Plex Server',
                username: 'guest_plexing',
                user: {
                  id: 22,
                  friendlyName: 'guest_plexing',
                },
              },
            ],
          }),
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          body: JSON.stringify({
            users: [{ id: 22, friendlyName: 'guest_plexing' }],
          }),
        }),
      );

    const service = new PlexService();
    const users = await service.listSharedUsersForServer({
      plexToken: 'token',
      machineIdentifier: 'machine-id',
    });

    expect(users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plexAccountId: 22,
          plexAccountTitle: 'guest_plexing',
        }),
      ]),
    );
    expect(users.map((user) => user.plexAccountTitle)).not.toContain(
      'Omar Plex Server',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns home users when shared users endpoints fail', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          body: 'not found',
          contentType: 'text/plain',
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          body: 'not found',
          contentType: 'text/plain',
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          body: JSON.stringify({
            users: [{ id: 99, friendlyName: 'Home User' }],
          }),
        }),
      );

    const service = new PlexService();
    const users = await service.listSharedUsersForServer({
      plexToken: 'token',
      machineIdentifier: 'machine-id',
    });

    expect(users).toEqual([
      expect.objectContaining({
        plexAccountId: 99,
        plexAccountTitle: 'Home User',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
