import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { RadarrService } from './radarr.service';

type TestConnectionBody = {
  baseUrl?: unknown;
  apiKey?: unknown;
};

@Controller('radarr')
export class RadarrController {
  constructor(private readonly radarrService: RadarrService) {}

  @Post('test')
  test(@Body() body: TestConnectionBody) {
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

    if (!baseUrl) throw new BadRequestException('baseUrl is required');
    if (!apiKey) throw new BadRequestException('apiKey is required');

    return this.radarrService.testConnection({ baseUrl, apiKey });
  }
}


