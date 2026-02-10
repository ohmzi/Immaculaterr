import { BadGatewayException } from '@nestjs/common';
import { OverseerrService } from './overseerr.service';

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

describe('OverseerrService', () => {
  const fetchMock = jest.fn();
  let service: OverseerrService;

  beforeEach(() => {
    fetchMock.mockReset();
    (global as { fetch: typeof fetch }).fetch = fetchMock as never;
    service = new OverseerrService();
  });

  it.each([
    ['http://localhost:5055', 'http://localhost:5055/api/v1/auth/me'],
    ['http://localhost:5055/', 'http://localhost:5055/api/v1/auth/me'],
    ['http://localhost:5055/api/v1', 'http://localhost:5055/api/v1/auth/me'],
  ])('normalizes baseUrl %s for auth test endpoint', async (baseUrl, expectedUrl) => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, json: { id: 1 } }));

    await service.testConnection({ baseUrl, apiKey: 'secret' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedUrl);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({
        'X-Api-Key': 'secret',
      }),
    });
  });

  it('throws BadGatewayException when testConnection is unauthorized', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 401, text: 'unauthorized' }),
    );

    await expect(
      service.testConnection({ baseUrl: 'http://localhost:5055', apiKey: 'bad' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('sends correct movie request payload', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 201, json: { id: 42 } }));

    const result = await service.requestMovie({
      baseUrl: 'http://localhost:5055/api/v1',
      apiKey: 'secret',
      tmdbId: 550.9,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:5055/api/v1/request');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      mediaType: 'movie',
      mediaId: 550,
    });
    expect(result).toEqual({ status: 'requested', requestId: 42, error: null });
  });

  it('sends correct TV request payload with seasons=all', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 201, json: { id: 7 } }));

    const result = await service.requestTvAllSeasons({
      baseUrl: 'http://localhost:5055',
      apiKey: 'secret',
      tmdbId: 1399.4,
      tvdbId: 121361.6,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:5055/api/v1/request');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      mediaType: 'tv',
      mediaId: 1399,
      tvdbId: 121361,
      seasons: 'all',
    });
    expect(result).toEqual({ status: 'requested', requestId: 7, error: null });
  });

  it('classifies duplicate/existing responses as exists', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 409, text: 'already requested' }),
    );

    const result = await service.requestMovie({
      baseUrl: 'http://localhost:5055',
      apiKey: 'secret',
      tmdbId: 12,
    });

    expect(result).toEqual({ status: 'exists', requestId: null, error: null });
  });

  it('returns failed for non-duplicate request errors', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 500, text: 'internal error' }),
    );

    const result = await service.requestMovie({
      baseUrl: 'http://localhost:5055',
      apiKey: 'secret',
      tmdbId: 12,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('HTTP 500');
  });
});
