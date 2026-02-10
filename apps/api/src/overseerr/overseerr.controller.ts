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
};

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
  test(@Body() body: TestConnectionBody) {
    const baseUrlRaw =
      typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

    if (!baseUrlRaw) throw new BadRequestException('baseUrl is required');
    if (!apiKey) throw new BadRequestException('apiKey is required');

    const baseUrl = /^https?:\/\//i.test(baseUrlRaw)
      ? baseUrlRaw
      : `http://${baseUrlRaw}`;

    try {
      const parsed = new URL(baseUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('Unsupported protocol');
      }
    } catch {
      throw new BadRequestException('baseUrl must be a valid http(s) URL');
    }

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
