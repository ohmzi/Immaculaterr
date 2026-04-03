import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';
import { OpenAiService } from './openai.service';
import { TestApiKeyDto } from '../shared/dto/test-connection.dto';

@Controller('openai')
export class OpenAiController {
  constructor(
    private readonly openAiService: OpenAiService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('test')
  async test(@Req() req: AuthenticatedRequest, @Body() body: TestApiKeyDto) {
    const resolved = await this.settingsService.resolveServiceSecretInput({
      userId: req.user.id,
      service: 'openai',
      secretField: 'apiKey',
      expectedPurpose: 'integration.openai.test',
      envelope: body.apiKeyEnvelope,
      secretRef: body.secretRef,
      plaintext: body.apiKey,
    });
    const apiKey = resolved.value;
    if (!apiKey) throw new BadRequestException('OPENAI_API_KEY is required');
    return this.openAiService.testConnection({ apiKey });
  }
}
