import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

  @Get('backup-info')
  backupInfo() {
    const appDataDir = process.env.APP_DATA_DIR?.trim() || null;
    const databaseUrl = process.env.DATABASE_URL?.trim() || null;

    const envMasterKeySet = Boolean(process.env.APP_MASTER_KEY?.trim());
    const envMasterKeyFilePath = process.env.APP_MASTER_KEY_FILE?.trim() || null;
    const envMasterKeyFileExists = envMasterKeyFilePath
      ? existsSync(envMasterKeyFilePath)
      : false;
    const keyFilePath = appDataDir ? join(appDataDir, 'app-master.key') : null;
    const keyFileExists = keyFilePath ? existsSync(keyFilePath) : false;

    const dbFilePath =
      databaseUrl && databaseUrl.startsWith('file:')
        ? databaseUrl.slice('file:'.length)
        : null;

    const masterKeySource = envMasterKeySet
      ? ('env' as const)
      : envMasterKeyFilePath
        ? ('file' as const)
        : ('dataDirFile' as const);

    const whatToBackup = [
      ...(appDataDir ? [appDataDir] : []),
      ...(dbFilePath ? [dbFilePath] : []),
      ...(masterKeySource === 'dataDirFile' && keyFilePath ? [keyFilePath] : []),
    ];

    return {
      appDataDir,
      databaseUrl,
      masterKey: {
        source: masterKeySource,
        envSet: envMasterKeySet,
        envFilePath: envMasterKeyFilePath,
        envFileExists: envMasterKeyFileExists,
        dataDirKeyFilePath: keyFilePath,
        dataDirKeyFileExists: keyFileExists,
      },
      whatToBackup,
    };
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

    // Enforce automation constraints (e.g. disable ARR-dependent schedules when ARR is disabled).
    await this.settingsService.enforceAutomationConstraints(userId);

    return await this.settingsService.getPublicSettings(userId);
  }
}
