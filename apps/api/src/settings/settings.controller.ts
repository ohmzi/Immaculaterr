import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import type { AuthenticatedRequest } from '../auth/auth.types';

type UpdateSettingsBody = {
  settings?: unknown;
  secrets?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

@Controller('settings')
@ApiTags('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.settingsService.getPublicSettings(req.user.id);
  }

  @Put()
  async put(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateSettingsBody,
  ) {
    const userId = req.user.id;
    const settingsPatch = body?.settings;
    const secretsPatch = body?.secrets;

    if (settingsPatch !== undefined && !isPlainObject(settingsPatch)) {
      throw new BadRequestException('settings must be an object');
    }
    if (secretsPatch !== undefined && !isPlainObject(secretsPatch)) {
      throw new BadRequestException('secrets must be an object');
    }

    if (settingsPatch) {
      await this.settingsService.updateSettings(userId, settingsPatch);
    }
    if (secretsPatch) {
      await this.settingsService.updateSecrets(userId, secretsPatch);
    }

    return await this.settingsService.getPublicSettings(userId);
  }
}
