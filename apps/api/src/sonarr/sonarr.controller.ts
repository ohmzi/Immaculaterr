import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';
import { SonarrService } from './sonarr.service';

type TestConnectionBody = {
  baseUrl?: unknown;
  apiKey?: unknown;
  apiKeyEnvelope?: unknown;
  secretRef?: unknown;
};

const HTTP_BASE_URL_PREFIX = /^https?:\/\//i;
const HTTP_PROTOCOL = /^https?:$/i;

function requireBaseUrl(raw: unknown): string {
  const baseUrlRaw = typeof raw === 'string' ? raw.trim() : '';
  if (baseUrlRaw) return baseUrlRaw;
  throw new BadRequestException('baseUrl is required');
}

function normalizeHttpBaseUrl(baseUrlRaw: string): string {
  const baseUrl = HTTP_BASE_URL_PREFIX.test(baseUrlRaw)
    ? baseUrlRaw
    : `http://${baseUrlRaw}`;
  try {
    const parsed = new URL(baseUrl);
    if (HTTP_PROTOCOL.test(parsed.protocol)) return baseUrl;
  } catch {
    // validated below
  }
  throw new BadRequestException('baseUrl must be a valid http(s) URL');
}

@Controller('sonarr')
export class SonarrController {
  constructor(
    private readonly sonarrService: SonarrService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('test')
  async test(@Req() req: AuthenticatedRequest, @Body() body: TestConnectionBody) {
    const baseUrlRaw = requireBaseUrl(body.baseUrl);
    const resolved = await this.settingsService.resolveServiceSecretInput({
      userId: req.user.id,
      service: 'sonarr',
      secretField: 'apiKey',
      expectedPurpose: 'integration.sonarr.test',
      envelope: body.apiKeyEnvelope,
      secretRef: body.secretRef,
      plaintext: body.apiKey,
    });
    const apiKey = resolved.value;
    if (!apiKey) throw new BadRequestException('apiKey is required');
    const baseUrl = normalizeHttpBaseUrl(baseUrlRaw);

    return this.sonarrService.testConnection({ baseUrl, apiKey });
  }
}
