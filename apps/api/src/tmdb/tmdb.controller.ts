import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';
import { TmdbService } from './tmdb.service';
import { TestApiKeyDto } from '../shared/dto/test-connection.dto';

@Controller('tmdb')
export class TmdbController {
  constructor(
    private readonly tmdbService: TmdbService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('test')
  async test(@Req() req: AuthenticatedRequest, @Body() body: TestApiKeyDto) {
    const resolved = await this.settingsService.resolveServiceSecretInput({
      userId: req.user.id,
      service: 'tmdb',
      secretField: 'apiKey',
      expectedPurpose: 'integration.tmdb.test',
      envelope: body.apiKeyEnvelope,
      secretRef: body.secretRef,
      plaintext: body.apiKey,
    });
    const apiKey = resolved.value;
    if (!apiKey) throw new BadRequestException('TMDB_API_KEY is required');
    return this.tmdbService.testConnection({ apiKey });
  }

  @Get('movie-filters')
  async getMovieFilters(@Req() req: AuthenticatedRequest) {
    const { secrets } = await this.settingsService.getInternalSettings(
      req.user.id,
    );
    const apiKey = this.settingsService.readServiceSecret('tmdb', secrets);
    if (!apiKey) throw new BadRequestException('TMDB_API_KEY is required');
    const metadata = await this.tmdbService.getMovieFilterMetadata({
      apiKey,
      countryCode: 'US',
    });
    return {
      ok: true,
      ...metadata,
    };
  }
}
