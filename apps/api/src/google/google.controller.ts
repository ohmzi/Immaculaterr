import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';
import { GoogleService } from './google.service';

type TestGoogleBody = {
  apiKey?: unknown;
  apiKeyEnvelope?: unknown;
  secretRef?: unknown;
  cseId?: unknown;
  numResults?: unknown;
  query?: unknown;
};

@Controller('google')
export class GoogleController {
  constructor(
    private readonly googleService: GoogleService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('test')
  async test(
    @Req() req: AuthenticatedRequest,
    @Body() body: TestGoogleBody,
  ) {
    const resolved = await this.settingsService.resolveServiceSecretInput({
      userId: req.user.id,
      service: 'google',
      secretField: 'apiKey',
      expectedPurpose: 'integration.google.test',
      envelope: body.apiKeyEnvelope,
      secretRef: body.secretRef,
      plaintext: body.apiKey,
    });
    const apiKey = resolved.value;
    const cseId = typeof body.cseId === 'string' ? body.cseId.trim() : '';
    const query =
      typeof body.query === 'string' ? body.query.trim() : 'imdb the matrix';

    let numResults = 15;
    if (
      typeof body.numResults === 'number' &&
      Number.isFinite(body.numResults)
    ) {
      numResults = Math.trunc(body.numResults);
    } else if (typeof body.numResults === 'string' && body.numResults.trim()) {
      const parsed = Number.parseInt(body.numResults.trim(), 10);
      if (Number.isFinite(parsed)) numResults = parsed;
    }

    if (!apiKey) throw new BadRequestException('GOOGLE_API_KEY is required');
    if (!cseId)
      throw new BadRequestException(
        'GOOGLE_CSE_ID (cx) is required for Google Programmable Search',
      );
    if (!query) throw new BadRequestException('query is required');

    return this.googleService.testConnection({
      apiKey,
      cseId,
      query,
      numResults,
    });
  }
}
