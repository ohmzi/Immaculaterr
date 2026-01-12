import { Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../db/prisma.service';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    // Prevent prototype pollution by blocking dangerous keys.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (value === undefined) continue;
    if (value === null) {
      target[key] = null;
      continue;
    }
    if (isPlainObject(value) && isPlainObject(target[key])) {
      target[key] = deepMerge(target[key], value);
      continue;
    }
    target[key] = value;
  }
  return target;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async getPublicSettings(userId: string) {
    const settings = await this.getSettingsDoc(userId);
    const secrets = await this.getSecretsDoc(userId);
    const secretsPresent = Object.fromEntries(
      Object.entries(secrets).map(([k, v]) => [k, Boolean(v)]),
    );

    return {
      settings,
      secretsPresent,
      meta: {
        dataDir: process.env.APP_DATA_DIR ?? null,
      },
    };
  }

  /**
   * Internal-only: returns decrypted secrets for server-side job execution.
   * Do NOT expose this response directly to the browser.
   */
  async getInternalSettings(userId: string) {
    return {
      settings: await this.getSettingsDoc(userId),
      secrets: await this.getSecretsDoc(userId),
    };
  }

  async updateSettings(userId: string, patch: Record<string, unknown>) {
    const current = await this.getSettingsDoc(userId);
    const next = deepMerge({ ...current }, patch);
    await this.prisma.userSettings.upsert({
      where: { userId },
      update: { value: JSON.stringify(next) },
      create: { userId, value: JSON.stringify(next) },
    });
    this.logger.log(`Updated settings userId=${userId}`);
    return next;
  }

  async updateSecrets(userId: string, patch: Record<string, unknown>) {
    const current = await this.getSecretsDoc(userId);
    const merged = deepMerge({ ...current }, patch);

    // Interpret nulls as deletes for secrets
    for (const [k, v] of Object.entries(merged)) {
      if (v === null) {
        delete merged[k];
      }
    }

    const encrypted = this.crypto.encryptString(JSON.stringify(merged));
    await this.prisma.userSecrets.upsert({
      where: { userId },
      update: { value: encrypted },
      create: { userId, value: encrypted },
    });
    this.logger.log(`Updated secrets userId=${userId}`);
    return Object.fromEntries(Object.entries(merged).map(([k]) => [k, true]));
  }

  /**
   * Enforce cross-setting constraints that impact background automation.
   *
   * Current rules:
   * - If BOTH Radarr and Sonarr are disabled/unconfigured, auto-run schedules for ARR-dependent jobs
   *   are force-disabled (even if they were previously enabled).
   */
  async enforceAutomationConstraints(userId: string) {
    const settings = await this.getSettingsDoc(userId);
    const secrets = await this.getSecretsDoc(userId);

    const readBool = (obj: Record<string, unknown>, path: string): boolean | null => {
      const parts = path.split('.');
      let cur: unknown = obj;
      for (const p of parts) {
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
        cur = (cur as Record<string, unknown>)[p];
      }
      return typeof cur === 'boolean' ? cur : null;
    };

    const radarrEnabledSetting = readBool(settings, 'radarr.enabled');
    const sonarrEnabledSetting = readBool(settings, 'sonarr.enabled');

    const radarrSecretsPresent = Boolean(secrets['radarr']);
    const sonarrSecretsPresent = Boolean(secrets['sonarr']);

    // Match the web UI's semantics:
    // - if enabled flag exists, it wins
    // - otherwise, presence of secrets implies enabled
    const radarrEnabled = (radarrEnabledSetting ?? radarrSecretsPresent) === true;
    const sonarrEnabled = (sonarrEnabledSetting ?? sonarrSecretsPresent) === true;

    if (radarrEnabled || sonarrEnabled) return;

    const res = await this.prisma.jobSchedule.updateMany({
      where: {
        jobId: { in: ['monitorConfirm', 'arrMonitoredSearch'] },
        enabled: true,
      },
      data: { enabled: false },
    });

    if (res.count > 0) {
      this.logger.log(
        `Disabled ARR-dependent schedules (Radarr+Sonarr disabled) userId=${userId} count=${res.count}`,
      );
    }
  }

  private async getSettingsDoc(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (!row?.value) return { onboarding: { completed: false } };
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return isPlainObject(parsed)
        ? parsed
        : { onboarding: { completed: false } };
    } catch {
      return { onboarding: { completed: false } };
    }
  }

  private async getSecretsDoc(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.prisma.userSecrets.findUnique({ where: { userId } });
    if (!row?.value) return {};

    try {
      const raw = this.crypto.isEncrypted(row.value)
        ? this.crypto.decryptString(row.value)
        : row.value;
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw) as unknown;
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}
