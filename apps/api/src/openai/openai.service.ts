import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type OpenAiModelsResponse = {
  data?: unknown;
};

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);

  async testConnection(params: { apiKey: string }) {
    const apiKey = params.apiKey.trim();

    this.logger.log('Testing OpenAI connection');

    const url = 'https://api.openai.com/v1/models';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await this.extractOpenAiError(res);
        throw new BadGatewayException(
          `OpenAI test failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`.trim(),
        );
      }

      const data = (await res.json()) as OpenAiModelsResponse;
      const models = Array.isArray(data.data) ? (data.data as Array<Record<string, unknown>>) : [];
      const ids = models
        .map((m) => (typeof m['id'] === 'string' ? (m['id'] as string) : null))
        .filter((x): x is string => Boolean(x));

      return {
        ok: true,
        meta: {
          count: ids.length,
          sample: ids.slice(0, 10),
        },
      };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `OpenAI test failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async extractOpenAiError(res: Response) {
    try {
      const payload = (await res.json()) as unknown;
      if (!payload || typeof payload !== 'object') return '';
      const err = (payload as Record<string, unknown>)['error'];
      if (!err || typeof err !== 'object') return '';

      const message = (err as Record<string, unknown>)['message'];
      const type = (err as Record<string, unknown>)['type'];
      const code = (err as Record<string, unknown>)['code'];

      return `message=${JSON.stringify(message)} type=${JSON.stringify(type)} code=${JSON.stringify(code)}`;
    } catch {
      try {
        const text = await res.text();
        return text ? `body=${JSON.stringify(text.slice(0, 300))}` : '';
      } catch {
        return '';
      }
    }
  }
}


