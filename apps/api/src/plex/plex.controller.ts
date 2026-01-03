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
    try {
      const parsed = new URL(baseUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('Unsupported protocol');
      }
    } catch {
      throw new BadRequestException('baseUrl must be a valid http(s) URL');
    }

    const machineIdentifier =
      await this.plexServerService.getMachineIdentifier({ baseUrl, token });

    return { ok: true, machineIdentifier };
  }

  @Get('library-growth')
  async libraryGrowth(@Req() req: AuthenticatedRequest) {
    return await this.plexAnalytics.getLibraryGrowth(req.user.id);
  }
}
