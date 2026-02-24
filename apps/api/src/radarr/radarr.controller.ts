import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';
import { RadarrService } from './radarr.service';

type TestConnectionBody = {
  baseUrl?: unknown;
  apiKey?: unknown;
  apiKeyEnvelope?: unknown;
  secretRef?: unknown;
};

const HTTP_BASE_URL_PREFIX = /^https?:\/\//i;
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function ensureHttpBaseUrlPrefix(baseUrlRaw: string): string {
  if (HTTP_BASE_URL_PREFIX.test(baseUrlRaw)) return baseUrlRaw;
  return `http://${baseUrlRaw}`;
}

function assertValidHttpBaseUrl(baseUrl: string): void {
  try {
    const parsed = new URL(baseUrl);
    if (!HTTP_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
}

function normalizeHttpBaseUrl(raw: unknown): string {
  const baseUrlRaw = typeof raw === 'string' ? raw.trim() : '';
  if (!baseUrlRaw) throw new BadRequestException('baseUrl is required');
  const baseUrl = ensureHttpBaseUrlPrefix(baseUrlRaw);
  assertValidHttpBaseUrl(baseUrl);
  return baseUrl;
}

@Controller('radarr')
export class RadarrController {
  constructor(
    private readonly radarrService: RadarrService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('test')
  async test(@Req() req: AuthenticatedRequest, @Body() body: TestConnectionBody) {
    const baseUrl = normalizeHttpBaseUrl(body.baseUrl);
    const resolved = await this.settingsService.resolveServiceSecretInput({
      userId: req.user.id,
      service: 'radarr',
      secretField: 'apiKey',
      expectedPurpose: 'integration.radarr.test',
      envelope: body.apiKeyEnvelope,
      secretRef: body.secretRef,
      plaintext: body.apiKey,
    });
    const apiKey = resolved.value;

    if (!apiKey) throw new BadRequestException('apiKey is required');

    return this.radarrService.testConnection({ baseUrl, apiKey });
  }
}
