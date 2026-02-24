import {
  BadRequestException,
  BadGatewayException,
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
  tokenEnvelope?: unknown;
  secretRef?: unknown;
};

function normalizeHttpBaseUrl(raw: unknown): string {
  const baseUrlRaw = requireBaseUrl(raw);
  const baseUrl = withDefaultHttpScheme(baseUrlRaw);
  assertHttpUrl(baseUrl);
  return baseUrl;
}

function requireBaseUrl(raw: unknown): string {
  const baseUrlRaw = typeof raw === 'string' ? raw.trim() : '';
  if (!baseUrlRaw) throw new BadRequestException('baseUrl is required');
  return baseUrlRaw;
}

function withDefaultHttpScheme(baseUrlRaw: string): string {
  return /^https?:\/\//i.test(baseUrlRaw) ? baseUrlRaw : `http://${baseUrlRaw}`;
}

function assertHttpUrl(baseUrl: string): void {
  try {
    const parsed = new URL(baseUrl);
    if (/^https?:$/i.test(parsed.protocol)) return;
  } catch {
    // validated below
  }
  throw new BadRequestException('baseUrl must be a valid http(s) URL');
}

function parseBaseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '';
  }
}

function buildDockerLocalhostHint(baseUrlHost: string): string {
  return baseUrlHost === 'localhost' || baseUrlHost === '127.0.0.1'
    ? " In Docker bridge networking, `localhost` points to the container. Use your Plex server's LAN IP (recommended) or switch Immaculaterr to Docker host networking so `localhost` works."
    : '';
}

function isUnauthorizedPlexError(message: string): boolean {
  return /HTTP\\s+401\\b/.test(message) || message.includes('401 Unauthorized');
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
  async test(
    @Req() req: AuthenticatedRequest,
    @Body() body: TestPlexServerBody,
  ) {
    const baseUrl = normalizeHttpBaseUrl(body.baseUrl);
    const resolved = await this.settingsService.resolveServiceSecretInput({
      userId: req.user.id,
      service: 'plex',
      secretField: 'token',
      expectedPurpose: 'integration.plex.test',
      envelope: body.tokenEnvelope,
      secretRef: body.secretRef,
      plaintext: body.token,
    });
    const token = resolved.value;

    if (!token) throw new BadRequestException('token is required');

    const dockerLocalhostHint = buildDockerLocalhostHint(parseBaseUrlHost(baseUrl));

    // Validate:
    // - token works against the Plex server (library/sections requires auth)
    // - baseUrl is reachable from the API process (common Docker pitfall: localhost)
    await this.assertPlexServerAccessible({ baseUrl, token, dockerLocalhostHint });

    const machineIdentifier =
      await this.plexServerService
        .getMachineIdentifier({ baseUrl, token })
        .catch(() => null);

    return { ok: true, machineIdentifier };
  }

  @Get('library-growth')
  async libraryGrowth(@Req() req: AuthenticatedRequest) {
    return await this.plexAnalytics.getLibraryGrowth(req.user.id);
  }

  @Get('library-growth/version')
  async libraryGrowthVersion(@Req() req: AuthenticatedRequest) {
    return await this.plexAnalytics.getLibraryGrowthVersion(req.user.id);
  }

  private async assertPlexServerAccessible(params: {
    baseUrl: string;
    token: string;
    dockerLocalhostHint: string;
  }): Promise<void> {
    const sections = await this.loadPlexSections(params);
    if (sections.length > 0) return;
    throw new BadGatewayException(
      `Plex responded but returned no library sections.${params.dockerLocalhostHint}`.trim(),
    );
  }

  private async loadPlexSections(params: {
    baseUrl: string;
    token: string;
    dockerLocalhostHint: string;
  }) {
    try {
      return await this.plexServerService.getSections({
        baseUrl: params.baseUrl,
        token: params.token,
      });
    } catch (err) {
      throw this.mapPlexConnectionError(err, params);
    }
  }

  private mapPlexConnectionError(
    err: unknown,
    params: { baseUrl: string; dockerLocalhostHint: string },
  ): BadRequestException | BadGatewayException {
    const msg = (err as Error)?.message ?? String(err);
    // Plex returns 401 when token is invalid or doesn't grant access.
    if (isUnauthorizedPlexError(msg)) {
      return new BadRequestException(
        `Plex token was rejected by the server (401 Unauthorized).${params.dockerLocalhostHint}`.trim(),
      );
    }
    return new BadGatewayException(
      `Could not connect to Plex at ${params.baseUrl}.${params.dockerLocalhostHint}`.trim(),
    );
  }
}
