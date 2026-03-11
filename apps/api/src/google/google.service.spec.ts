import { BadGatewayException } from '@nestjs/common';
import { GoogleService } from './google.service';

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

describe('GoogleService', () => {
  const fetchMock = jest.fn();
  let service: GoogleService;

  beforeEach(() => {
    fetchMock.mockReset();
    (global as { fetch: typeof fetch }).fetch = fetchMock as never;
    service = new GoogleService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns search results on successful testConnection', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        json: {
          items: [
            {
              title: 'Immaculaterr',
              snippet: 'Search result',
              link: 'https://example.com/result',
            },
          ],
        },
      }),
    );

    await expect(
      service.testConnection({
        apiKey: 'key-123',
        cseId: 'cse-1',
        query: 'immaculaterr',
        numResults: 1,
      }),
    ).resolves.toEqual({
      ok: true,
      results: [
        {
          title: 'Immaculaterr',
          snippet: 'Search result',
          link: 'https://example.com/result',
        },
      ],
      meta: { requested: 1, returned: 1 },
    });
  });

  it('retries testConnection with IPv4 fallback on connectivity failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const fallbackSpy = jest
      .spyOn(service as any, 'fetchGoogleResponseWithIpv4')
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          json: {
            items: [
              {
                title: 'Immaculaterr',
                snippet: 'Search result',
                link: 'https://example.com/result',
              },
            ],
          },
        }),
      );

    const result = await service.testConnection({
      apiKey: 'key-123',
      cseId: 'cse-1',
      query: 'immaculaterr',
      numResults: 1,
    });

    expect(fallbackSpy).toHaveBeenCalledTimes(1);
    expect(result.meta.returned).toBe(1);
  });

  it('does not use IPv4 fallback when Google responds with HTTP 403', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 403,
        json: {
          error: {
            message: 'API key not valid. Please pass a valid API key.',
            errors: [{ reason: 'keyInvalid' }],
          },
        },
      }),
    );
    const fallbackSpy = jest.spyOn(
      service as any,
      'fetchGoogleResponseWithIpv4',
    );

    await expect(
      service.testConnection({
        apiKey: 'bad-key',
        cseId: 'cse-1',
        query: 'immaculaterr',
        numResults: 1,
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(fallbackSpy).not.toHaveBeenCalled();
  });
});
