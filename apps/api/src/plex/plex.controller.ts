import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { PlexService } from './plex.service';
import { PlexServerService } from './plex-server.service';
import { PlexAnalyticsService } from './plex-analytics.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';

type TestPlexServerBody = {
  baseUrl?: unknown;
  token?: unknown;
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
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol))
      throw new Error('Unsupported protocol');
  } catch {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

@Controller('plex')
export class PlexController {
  constructor(
    private readonly plexService: PlexService,
    private readonly plexServerService: PlexServerService,
    private readonly plexAnalytics: PlexAnalyticsService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('pin')
  createPin() {
    return this.plexService.createPin();
  }

  @Get('pin/:id')
  checkPin(@Param('id') id: string) {
    const pinId = Number.parseInt(id, 10);
    if (!Number.isFinite(pinId) || pinId <= 0) {
      throw new BadRequestException('Invalid pin id');
    }
    return this.plexService.checkPin(pinId);
  }

  @Get('whoami')
  whoami(@Headers('x-plex-token') plexToken?: string) {
    if (!plexToken) {
      throw new BadRequestException('Missing header: X-Plex-Token');
    }
    return this.plexService.whoami(plexToken);
  }

  @Post('test')
  async test(@Body() body: TestPlexServerBody) {
    const baseUrlRaw =
      typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const token = typeof body.token === 'string' ? body.token.trim() : '';

    if (!baseUrlRaw) throw new BadRequestException('baseUrl is required');
    if (!token) throw new BadRequestException('token is required');

    // Allow inputs like "localhost:32400" by defaulting to http://
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

    const machineIdentifier = await this.plexServerService.getMachineIdentifier(
      { baseUrl, token },
    );

    return { ok: true, machineIdentifier };
  }

  @Get('library-growth')
  async libraryGrowth(@Req() req: AuthenticatedRequest) {
    return await this.plexAnalytics.getLibraryGrowth(req.user.id);
  }

  @Get('libraries')
  async libraries(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);

    const baseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const token =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');

    if (!baseUrlRaw || !token) {
      throw new BadRequestException('Plex is not configured');
    }

    const baseUrl = normalizeHttpUrl(baseUrlRaw);
    const sections = await this.plexServerService.getSections({ baseUrl, token });

    const movies = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'movie')
      .sort((a, b) => a.title.localeCompare(b.title));
    const tv = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'show')
      .sort((a, b) => a.title.localeCompare(b.title));

    return { ok: true, movies, tv };
  }
}
