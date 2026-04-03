import {
  BadRequestException,
  BadGatewayException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { PlexService } from './plex.service';
import { PlexServerService } from './plex-server.service';
import { PlexAnalyticsService } from './plex-analytics.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';
import {
  PLEX_OAUTH_POLL_HEADER,
  PLEX_OAUTH_POLL_HEADER_VALUE,
} from '../app.constants';
import { TestPlexServerDto } from '../shared/dto/test-connection.dto';

const HTTP_BASE_URL_PREFIX = /^https?:\/\//i;
const HTTP_PROTOCOL = /^https?:$/i;
const PLEX_UNAUTHORIZED_ERROR = /HTTP\s+401\b/;

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
  return HTTP_BASE_URL_PREFIX.test(baseUrlRaw)
    ? baseUrlRaw
    : `http://${baseUrlRaw}`;
}

function assertHttpUrl(baseUrl: string): void {
  try {
    const parsed = new URL(baseUrl);
    if (HTTP_PROTOCOL.test(parsed.protocol)) return;
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
  return (
    PLEX_UNAUTHORIZED_ERROR.test(message) ||
    message.includes('401 Unauthorized')
  );
}

function mapPlexConnectionError(
  err: unknown,
  params: { baseUrl: string; dockerLocalhostHint: string },
): BadRequestException | BadGatewayException {
  const message = (err as Error)?.message ?? String(err);
  // Plex returns 401 when token is invalid or doesn't grant access.
  if (isUnauthorizedPlexError(message)) {
    return new BadRequestException(
      `Plex token was rejected by the server (401 Unauthorized).${params.dockerLocalhostHint}`.trim(),
    );
  }
  return new BadGatewayException(
    `Could not connect to Plex at ${params.baseUrl}.${params.dockerLocalhostHint}`.trim(),
  );
}

@Controller('plex')
export class PlexController {
  private readonly logger = new Logger(PlexController.name);

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
  async checkPin(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers(PLEX_OAUTH_POLL_HEADER) oauthPollHeader?: string,
  ) {
    const pinId = Number.parseInt(id, 10);
    if (!Number.isFinite(pinId) || pinId <= 0) {
      throw new BadRequestException('Invalid pin id');
    }
    const pinStatus = await this.plexService.checkPin(pinId);
    const shouldPersistAuthToken =
      oauthPollHeader === PLEX_OAUTH_POLL_HEADER_VALUE;
    if (!pinStatus.authToken || !shouldPersistAuthToken) {
      return { ...pinStatus, authTokenStored: false };
    }

    const authTokenStored = await this.persistAuthorizedPinToken({
      userId: req.user.id,
      pinId,
      authToken: pinStatus.authToken,
    });
    return { ...pinStatus, authTokenStored };
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
    @Body() body: TestPlexServerDto,
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

    const dockerLocalhostHint = buildDockerLocalhostHint(
      parseBaseUrlHost(baseUrl),
    );

    // Validate:
    // - token works against the Plex server (library/sections requires auth)
    // - baseUrl is reachable from the API process (common Docker pitfall: localhost)
    await this.assertPlexServerAccessible({
      baseUrl,
      token,
      dockerLocalhostHint,
    });

    const machineIdentifier = await this.plexServerService
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
      throw mapPlexConnectionError(err, params);
    }
  }

  private async persistAuthorizedPinToken(params: {
    userId: string;
    pinId: number;
    authToken: string;
  }): Promise<boolean> {
    try {
      await this.settingsService.updateSecrets(params.userId, {
        plex: { token: params.authToken },
      });
      return true;
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      this.logger.warn(
        `Failed to persist OAuth Plex token for pin id=${params.pinId} userId=${params.userId}: ${message}`,
      );
      return false;
    }
  }
}
