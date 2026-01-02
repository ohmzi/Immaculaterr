import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { TmdbService } from './tmdb.service';

type TestTmdbBody = {
  apiKey?: unknown;
};

@Controller('tmdb')
export class TmdbController {
  constructor(private readonly tmdbService: TmdbService) {}

  @Post('test')
  test(@Body() body: TestTmdbBody) {
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) throw new BadRequestException('TMDB_API_KEY is required');
    return this.tmdbService.testConnection({ apiKey });
  }
}
