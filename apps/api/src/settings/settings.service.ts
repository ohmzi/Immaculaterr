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
