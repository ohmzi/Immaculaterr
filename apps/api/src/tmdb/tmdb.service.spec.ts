import { BadGatewayException } from '@nestjs/common';
import { TmdbService } from './tmdb.service';

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

describe('TmdbService', () => {
  const fetchMock = jest.fn();
  let service: TmdbService;

  beforeEach(() => {
    fetchMock.mockReset();
    (global as { fetch: typeof fetch }).fetch = fetchMock as never;
    service = new TmdbService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns TMDB configuration summary on successful connection test', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        json: {
          images: {
            secure_base_url: 'https://image.tmdb.org/t/p/',
          },
        },
      }),
    );

    await expect(
      service.testConnection({ apiKey: 'key-123' }),
    ).resolves.toEqual({
      ok: true,
      summary: {
        secureBaseUrl: 'https://image.tmdb.org/t/p/',
      },
      configuration: {
        images: {
          secure_base_url: 'https://image.tmdb.org/t/p/',
        },
      },
    });
  });

  it('retries TMDB connection test with IPv4 fallback on connectivity failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const ipv4FallbackSpy = jest
      .spyOn(service as any, 'fetchTmdbJsonWithIpv4')
      .mockResolvedValueOnce({
        images: {
          secure_base_url: 'https://image.tmdb.org/t/p/',
        },
      });

    const result = await service.testConnection({ apiKey: 'key-123' });

    expect(ipv4FallbackSpy).toHaveBeenCalledTimes(1);
    expect(result.summary.secureBaseUrl).toBe('https://image.tmdb.org/t/p/');
  });

  it('does not use IPv4 fallback when TMDB responds with HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 401,
        text: 'Invalid API key: You must be granted a valid key.',
      }),
    );
    const ipv4FallbackSpy = jest.spyOn(service as any, 'fetchTmdbJsonWithIpv4');

    await expect(
      service.testConnection({ apiKey: 'bad-key' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(ipv4FallbackSpy).not.toHaveBeenCalled();
  });
});
