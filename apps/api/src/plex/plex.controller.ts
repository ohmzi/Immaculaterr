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

type TestPlexServerBody = {
  baseUrl?: unknown;
  token?: unknown;
};

@Controller('plex')
export class PlexController {
  constructor(
    private readonly plexService: PlexService,
    private readonly plexServerService: PlexServerService,
    private readonly plexAnalytics: PlexAnalyticsService,
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
    const baseUrlHost = (() => {
      try {
        return new URL(baseUrl).hostname;
      } catch {
        return '';
      }
    })();
    const dockerLocalhostHint =
      baseUrlHost === 'localhost' || baseUrlHost === '127.0.0.1'
        ? " In Docker bridge networking, `localhost` points to the container. Use your Plex server's LAN IP (recommended) or switch Immaculaterr to Docker host networking so `localhost` works."
        : '';
    try {
      const parsed = new URL(baseUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('Unsupported protocol');
      }
    } catch {
      throw new BadRequestException('baseUrl must be a valid http(s) URL');
    }

    // Validate:
    // - token works against the Plex server (library/sections requires auth)
    // - baseUrl is reachable from the API process (common Docker pitfall: localhost)
    try {
      const sections = await this.plexServerService.getSections({ baseUrl, token });
      if (!sections.length) {
        throw new BadGatewayException(
          `Plex responded but returned no library sections.${dockerLocalhostHint}`.trim(),
        );
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      // Plex returns 401 when token is invalid or doesn't grant access.
      if (/HTTP\\s+401\\b/.test(msg) || msg.includes('401 Unauthorized')) {
        throw new BadRequestException(
          `Plex token was rejected by the server (401 Unauthorized).${dockerLocalhostHint}`.trim(),
        );
      }
      throw new BadGatewayException(
        `Could not connect to Plex at ${baseUrl}.${dockerLocalhostHint}`.trim(),
      );
    }

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
}
