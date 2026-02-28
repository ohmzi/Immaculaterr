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
  secretsEnvelope?: unknown;
};

type ParsedUpdateSettingsBody = {
  settingsPatch?: Record<string, unknown>;
  secretsPatch?: Record<string, unknown>;
  secretsEnvelope?: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseObjectPatch(
  value: unknown,
  fieldName: 'settings' | 'secrets' | 'secretsEnvelope',
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new BadRequestException(`${fieldName} must be an object`);
  }
  return value;
}

function parseUpdateSettingsBody(body: UpdateSettingsBody): ParsedUpdateSettingsBody {
  return {
    settingsPatch: parseObjectPatch(body?.settings, 'settings'),
    secretsPatch: parseObjectPatch(body?.secrets, 'secrets'),
    secretsEnvelope: parseObjectPatch(body?.secretsEnvelope, 'secretsEnvelope'),
  };
}

@Controller('settings')
@ApiTags('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.settingsService.getPublicSettings(req.user.id);
  }

  @Get('secrets-key')
  secretsKey() {
    return this.settingsService.getSecretsEnvelopeKey();
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

    const dbFilePath = databaseUrl?.startsWith('file:')
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
    const updates = parseUpdateSettingsBody(body);
    await this.applyUpdatePatches(userId, updates);

    // Enforce automation constraints (e.g. disable ARR-dependent schedules when ARR is disabled).
    await this.settingsService.enforceAutomationConstraints(userId);

    return await this.settingsService.getPublicSettings(userId);
  }

  private async applyUpdatePatches(
    userId: string,
    updates: ParsedUpdateSettingsBody,
  ): Promise<void> {
    if (updates.settingsPatch) {
      await this.settingsService.updateSettings(userId, updates.settingsPatch);
    }
    if (updates.secretsEnvelope) {
      await this.settingsService.updateSecretsFromEnvelope(
        userId,
        updates.secretsEnvelope,
      );
    }
    if (updates.secretsPatch) {
      this.settingsService.assertPlaintextSecretTransportAllowed();
      await this.settingsService.updateSecrets(userId, updates.secretsPatch);
    }
  }
}
