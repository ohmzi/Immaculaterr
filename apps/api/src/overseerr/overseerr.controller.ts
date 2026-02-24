import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';
import { OverseerrService } from './overseerr.service';

type TestConnectionBody = {
  baseUrl?: unknown;
  apiKey?: unknown;
  apiKeyEnvelope?: unknown;
  secretRef?: unknown;
};

function normalizeHttpBaseUrl(raw: unknown): string {
  const baseUrlRaw = typeof raw === 'string' ? raw.trim() : '';
  if (!baseUrlRaw) throw new BadRequestException('baseUrl is required');
  const baseUrl = /^https?:\/\//i.test(baseUrlRaw)
    ? baseUrlRaw
    : `http://${baseUrlRaw}`;
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
    return baseUrl;
  } catch {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const value = pick(obj, path);
  return typeof value === 'string' ? value.trim() : '';
}

@Controller('overseerr')
export class OverseerrController {
  constructor(
    private readonly overseerrService: OverseerrService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('test')
  async test(
    @Req() req: AuthenticatedRequest,
    @Body() body: TestConnectionBody,
  ) {
    const baseUrl = normalizeHttpBaseUrl(body.baseUrl);
    const resolved = await this.settingsService.resolveServiceSecretInput({
      userId: req.user.id,
      service: 'overseerr',
      secretField: 'apiKey',
      expectedPurpose: 'integration.overseerr.test',
      envelope: body.apiKeyEnvelope,
      secretRef: body.secretRef,
      plaintext: body.apiKey,
    });
    const apiKey = resolved.value;

    if (!apiKey) throw new BadRequestException('apiKey is required');

    return this.overseerrService.testConnection({ baseUrl, apiKey });
  }

  @Delete('requests/reset')
  async clearAllRequests(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const baseUrl =
      pickString(settings, 'overseerr.baseUrl');
    const apiKey = pickString(secrets, 'overseerr.apiKey');
    if (!baseUrl) throw new BadRequestException('Overseerr baseUrl is not set');
    if (!apiKey) throw new BadRequestException('Overseerr apiKey is not set');

    const result = await this.overseerrService.clearAllRequests({
      baseUrl,
      apiKey,
    });

    return { ok: true, ...result };
  }
}
