import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { OverseerrService } from './overseerr.service';

type TestOverseerrBody = {
  baseUrl?: unknown;
  apiKey?: unknown;
};

@Controller('overseerr')
export class OverseerrController {
  constructor(private readonly overseerrService: OverseerrService) {}

  @Post('test')
  test(@Body() body: TestOverseerrBody) {
    const baseUrlRaw = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

    if (!baseUrlRaw) throw new BadRequestException('baseUrl is required');
    if (!apiKey) throw new BadRequestException('apiKey is required');

    const baseUrl = /^https?:\/\//i.test(baseUrlRaw) ? baseUrlRaw : `http://${baseUrlRaw}`;
    try {
      const parsed = new URL(baseUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('Unsupported protocol');
      }
    } catch {
      throw new BadRequestException('baseUrl must be a valid http(s) URL');
    }

    return this.overseerrService.testConnection({ baseUrl, apiKey });
  }
}


