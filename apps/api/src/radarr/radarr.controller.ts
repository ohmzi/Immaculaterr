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

@Controller('radarr')
export class RadarrController {
  constructor(
    private readonly radarrService: RadarrService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('test')
  async test(@Req() req: AuthenticatedRequest, @Body() body: TestConnectionBody) {
    const baseUrlRaw =
      typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
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

    if (!baseUrlRaw) throw new BadRequestException('baseUrl is required');
    if (!apiKey) throw new BadRequestException('apiKey is required');

    // Allow inputs like "localhost:7878" by defaulting to http://
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

    return this.radarrService.testConnection({ baseUrl, apiKey });
  }
}
