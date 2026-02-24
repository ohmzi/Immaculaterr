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

function parseString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseIntegerLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

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
    const cseId = parseString(body.cseId);
    const query = parseString(body.query) || 'imdb the matrix';
    const numResults = parseIntegerLike(body.numResults) ?? 15;

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
