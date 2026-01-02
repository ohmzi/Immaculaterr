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
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

    if (!baseUrl) throw new BadRequestException('baseUrl is required');
    if (!apiKey) throw new BadRequestException('apiKey is required');

    return this.sonarrService.testConnection({ baseUrl, apiKey });
  }
}


