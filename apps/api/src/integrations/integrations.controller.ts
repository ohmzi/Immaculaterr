import { BadRequestException, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { GoogleService } from '../google/google.service';
import { OpenAiService } from '../openai/openai.service';
import { OverseerrService } from '../overseerr/overseerr.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SettingsService } from '../settings/settings.service';
import { SonarrService } from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) throw new Error('Unsupported protocol');
  } catch {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

@Controller('integrations')
@ApiTags('integrations')
export class IntegrationsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
    private readonly tmdb: TmdbService,
    private readonly google: GoogleService,
    private readonly openai: OpenAiService,
    private readonly overseerr: OverseerrService,
  ) {}

  @Post('test/:integrationId')
  async testSaved(@Req() req: Request, @Param('integrationId') integrationId: string) {
    const user = (req as any).user as { id: string } | undefined;
    const userId = user?.id ?? '';
    const { settings, secrets } = await this.settingsService.getInternalSettings(userId);

    const id = integrationId.toLowerCase();

    if (id === 'plex') {
      const baseUrlRaw = asString((settings as any)?.plex?.baseUrl);
      const token = asString((secrets as any)?.plex?.token);
      if (!baseUrlRaw) throw new BadRequestException('Plex baseUrl is not set');
      if (!token) throw new BadRequestException('Plex token is not set');
      const baseUrl = normalizeHttpUrl(baseUrlRaw);
      const machineIdentifier = await this.plexServer.getMachineIdentifier({ baseUrl, token });
      return { ok: true, summary: { machineIdentifier } };
    }

    if (id === 'radarr') {
      const baseUrlRaw = asString((settings as any)?.radarr?.baseUrl);
      const apiKey = asString((secrets as any)?.radarr?.apiKey);
      if (!baseUrlRaw) throw new BadRequestException('Radarr baseUrl is not set');
      if (!apiKey) throw new BadRequestException('Radarr apiKey is not set');
      const baseUrl = normalizeHttpUrl(baseUrlRaw);
      const result = await this.radarr.testConnection({ baseUrl, apiKey });
      return { ok: true, result };
    }

    if (id === 'sonarr') {
      const baseUrlRaw = asString((settings as any)?.sonarr?.baseUrl);
      const apiKey = asString((secrets as any)?.sonarr?.apiKey);
      if (!baseUrlRaw) throw new BadRequestException('Sonarr baseUrl is not set');
      if (!apiKey) throw new BadRequestException('Sonarr apiKey is not set');
      const baseUrl = normalizeHttpUrl(baseUrlRaw);
      const result = await this.sonarr.testConnection({ baseUrl, apiKey });
      return { ok: true, result };
    }

    if (id === 'tmdb') {
      const apiKey = asString((secrets as any)?.tmdb?.apiKey);
      if (!apiKey) throw new BadRequestException('TMDB apiKey is not set');
      const result = await this.tmdb.testConnection({ apiKey });
      return { ok: true, result };
    }

    if (id === 'google') {
      const apiKey = asString((secrets as any)?.google?.apiKey);
      const cseId = asString((settings as any)?.google?.searchEngineId);
      if (!apiKey) throw new BadRequestException('Google apiKey is not set');
      if (!cseId) throw new BadRequestException('Google searchEngineId is not set');
      const result = await this.google.testConnection({
        apiKey,
        cseId,
        query: 'tautulli curated plex',
        numResults: 3,
      });
      return { ok: true, result };
    }

    if (id === 'openai') {
      const apiKey = asString((secrets as any)?.openai?.apiKey);
      if (!apiKey) throw new BadRequestException('OpenAI apiKey is not set');
      const result = await this.openai.testConnection({ apiKey });
      return { ok: true, result };
    }

    if (id === 'overseerr') {
      const baseUrlRaw = asString((settings as any)?.overseerr?.baseUrl);
      const apiKey = asString((secrets as any)?.overseerr?.apiKey);
      if (!baseUrlRaw) throw new BadRequestException('Overseerr baseUrl is not set');
      if (!apiKey) throw new BadRequestException('Overseerr apiKey is not set');
      const baseUrl = normalizeHttpUrl(baseUrlRaw);
      const result = await this.overseerr.testConnection({ baseUrl, apiKey });
      return { ok: true, result };
    }

    throw new BadRequestException(`Unknown integrationId: ${integrationId}`);
  }
}


