import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { SonarrService } from './sonarr.service';

type TestConnectionBody = {
  baseUrl?: unknown;
  apiKey?: unknown;
};

@Controller('sonarr')
export class SonarrController {
  constructor(private readonly sonarrService: SonarrService) {}

  @Post('test')
  test(@Body() body: TestConnectionBody) {
    const baseUrlRaw =
      typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

    if (!baseUrlRaw) throw new BadRequestException('baseUrl is required');
    if (!apiKey) throw new BadRequestException('apiKey is required');

    // Allow inputs like "localhost:8989" by defaulting to http://
    const baseUrl = /^https?:\/\//i.test(baseUrlRaw)
      ? baseUrlRaw
      : `http://${baseUrlRaw}`;
    try {
      const parsed = new URL(baseUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('Unsupported protocol');
      }
    } catch {
      throw new BadRequestException('baseUrl must be a valid http(s) URL');
    }

    return this.sonarrService.testConnection({ baseUrl, apiKey });
  }
}
