import { BadRequestException, Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SettingsService } from './settings.service';
import { buildPatchesFromLegacyConfig, parseLegacyYaml } from './yaml-import';

type UpdateSettingsBody = {
  settings?: unknown;
  secrets?: unknown;
};

type ImportYamlBody = {
  yaml?: unknown;
  mode?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectLeafPaths(
  value: unknown,
  prefix = '',
  out: string[] = [],
): string[] {
  if (!value) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (prefix) out.push(prefix);
    return out;
  }
  if (Array.isArray(value)) {
    if (prefix) out.push(prefix);
    return out;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      collectLeafPaths(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

@Controller('settings')
@ApiTags('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(@Req() req: Request) {
    const user = (req as any).user as { id: string } | undefined;
    return this.settingsService.getPublicSettings(user?.id ?? '');
  }

  @Put()
  async put(@Req() req: Request, @Body() body: UpdateSettingsBody) {
    const user = (req as any).user as { id: string } | undefined;
    const userId = user?.id ?? '';
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

  @Post('import-yaml')
  async importYaml(@Req() req: Request, @Body() body: ImportYamlBody) {
    const user = (req as any).user as { id: string } | undefined;
    const userId = user?.id ?? '';
    const yamlText = typeof body?.yaml === 'string' ? body.yaml : '';
    if (!yamlText.trim()) {
      throw new BadRequestException('yaml is required');
    }

    const modeRaw = typeof body?.mode === 'string' ? body.mode : 'preview';
    const mode = modeRaw === 'apply' ? 'apply' : 'preview';

    let parsed: unknown;
    try {
      parsed = parseLegacyYaml(yamlText);
    } catch (err) {
      throw new BadRequestException(
        `Invalid YAML: ${(err as Error)?.message ?? String(err)}`,
      );
    }

    const { settingsPatch, secretsPatch, warnings } =
      buildPatchesFromLegacyConfig(parsed);

    if (mode === 'apply') {
      if (Object.keys(settingsPatch).length) {
        await this.settingsService.updateSettings(userId, settingsPatch);
      }
      if (Object.keys(secretsPatch).length) {
        await this.settingsService.updateSecrets(userId, secretsPatch);
      }
      return {
        ok: true,
        applied: true,
        warnings,
        result: await this.settingsService.getPublicSettings(userId),
      };
    }

    return {
      ok: true,
      applied: false,
      warnings,
      preview: {
        settingsPatch,
        secretsPaths: collectLeafPaths(secretsPatch),
      },
    };
  }
}


