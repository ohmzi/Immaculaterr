import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';
import { TmdbService } from './tmdb.service';

type TestTmdbBody = {
  apiKey?: unknown;
  apiKeyEnvelope?: unknown;
  secretRef?: unknown;
};

@Controller('tmdb')
export class TmdbController {
  constructor(
    private readonly tmdbService: TmdbService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('test')
  async test(@Req() req: AuthenticatedRequest, @Body() body: TestTmdbBody) {
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
}
