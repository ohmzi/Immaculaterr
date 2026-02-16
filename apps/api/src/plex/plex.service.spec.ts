import { PlexService } from './plex.service';

type MockResponseParams = {
  ok: boolean;
  status: number;
  body: string;
  contentType?: string;
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
