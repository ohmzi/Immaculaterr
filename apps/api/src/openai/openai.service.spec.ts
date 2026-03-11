import { BadGatewayException } from '@nestjs/common';
import { OpenAiService } from './openai.service';

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

describe('OpenAiService', () => {
  const fetchMock = jest.fn();
  let service: OpenAiService;

  beforeEach(() => {
    fetchMock.mockReset();
    (global as { fetch: typeof fetch }).fetch = fetchMock as never;
    service = new OpenAiService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns model metadata on successful testConnection', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 200,
        json: {
          data: [{ id: 'gpt-5.2-chat-latest' }, { id: 'gpt-4o-mini' }],
        },
      }),
    );

    await expect(
      service.testConnection({ apiKey: 'key-123' }),
    ).resolves.toEqual({
      ok: true,
      meta: {
        count: 2,
        sample: ['gpt-5.2-chat-latest', 'gpt-4o-mini'],
      },
    });
  });

  it('retries testConnection with IPv4 fallback on connectivity failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const fallbackSpy = jest
      .spyOn(service as any, 'fetchOpenAiResponseWithIpv4')
      .mockResolvedValueOnce(
        mockResponse({
          status: 200,
          json: { data: [{ id: 'gpt-5.2-chat-latest' }] },
        }),
      );

    const result = await service.testConnection({ apiKey: 'key-123' });

    expect(fallbackSpy).toHaveBeenCalledTimes(1);
    expect(result.meta.count).toBe(1);
  });

  it('does not use IPv4 fallback when OpenAI responds with HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 401,
        json: {
          error: {
            message: 'Incorrect API key provided',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        },
      }),
    );
    const fallbackSpy = jest.spyOn(
      service as any,
      'fetchOpenAiResponseWithIpv4',
    );

    await expect(
      service.testConnection({ apiKey: 'bad-key' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(fallbackSpy).not.toHaveBeenCalled();
  });
});
