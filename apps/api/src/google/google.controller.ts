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
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value !== 'string') return null;
  return parseIntegerString(value);
}

function parseIntegerString(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
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
    const input = await this.resolveTestInput(req.user.id, body);
    this.assertRequiredTestInput(input);
    return this.googleService.testConnection(input);
  }

  private async resolveTestInput(
    userId: string,
    body: TestGoogleBody,
  ): Promise<{
    apiKey: string;
    cseId: string;
    query: string;
    numResults: number;
  }> {
    const resolved = await this.settingsService.resolveServiceSecretInput({
      userId,
      service: 'google',
      secretField: 'apiKey',
      expectedPurpose: 'integration.google.test',
      envelope: body.apiKeyEnvelope,
      secretRef: body.secretRef,
      plaintext: body.apiKey,
    });
    return {
      apiKey: resolved.value,
      cseId: parseString(body.cseId),
      query: this.resolveQuery(body.query),
      numResults: parseIntegerLike(body.numResults) ?? 15,
    };
  }

  private resolveQuery(raw: unknown): string {
    const query = parseString(raw);
    return query || 'imdb the matrix';
  }

  private assertRequiredTestInput(params: {
    apiKey: string;
    cseId: string;
    query: string;
  }): void {
    if (!params.apiKey) {
      throw new BadRequestException('GOOGLE_API_KEY is required');
    }
    if (!params.cseId) {
      throw new BadRequestException(
        'GOOGLE_CSE_ID (cx) is required for Google Programmable Search',
      );
    }
    if (!params.query) throw new BadRequestException('query is required');
  }
}
