import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  type CuttingRoomRules,
  DEFAULT_CUTTING_ROOM_RULES,
  normalizeCuttingRoomRules,
} from './cutting-room-scoring';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Per-user Cutting Room rules stored under `settings.cuttingRoom` in the
 * UserSettings JSON document (with a read fallback to the legacy
 * `settings.curation` key from before the feature was renamed). Defaults are
 * intentionally generic (no library names, no tag names) — every protection is
 * something the user picks from their own setup.
 */
@Injectable()
export class CuttingRoomRulesService {
  constructor(private readonly settingsService: SettingsService) {}

  async getRules(userId: string): Promise<CuttingRoomRules> {
    const { settings } = await this.settingsService.getInternalSettings(userId);
    const doc = isPlainObject(settings) ? settings : {};
    return normalizeCuttingRoomRules(doc['cuttingRoom'] ?? doc['curation']);
  }

  async updateRules(
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<CuttingRoomRules> {
    const current = await this.getRules(userId);
    const merged: Record<string, unknown> = {
      ...(current as unknown as Record<string, unknown>),
      ...patch,
    };
    if (isPlainObject(patch['factors'])) {
      merged['factors'] = {
        ...(current.factors as unknown as Record<string, unknown>),
        ...patch['factors'],
      };
    } else {
      merged['factors'] = current.factors;
    }
    const normalized = normalizeCuttingRoomRules(merged);
    await this.settingsService.updateSettings(userId, {
      cuttingRoom: normalized as unknown as Record<string, unknown>,
    });
    return normalized;
  }

  defaults(): CuttingRoomRules {
    return DEFAULT_CUTTING_ROOM_RULES;
  }
}
