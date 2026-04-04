import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

@Injectable()
export class WebhookSecretService implements OnModuleInit {
  private readonly logger = new Logger(WebhookSecretService.name);
  private secret = '';

  private static readonly SECRET_FILENAME = 'webhook-secret';
  private static readonly SECRET_BYTES = 32;

  async onModuleInit() {
    const envSecret = process.env.PLEX_WEBHOOK_SECRET?.trim();
    if (envSecret) {
      this.secret = envSecret;
      return;
    }

    const persisted = await this.tryLoadFromFile();
    if (persisted) {
      this.secret = persisted;
      this.logger.log('Loaded webhook secret from persisted file.');
      return;
    }

    const generated = randomBytes(WebhookSecretService.SECRET_BYTES).toString(
      'hex',
    );
    await this.persistToFile(generated);
    this.secret = generated;
    this.logger.log(
      'Generated and persisted new webhook secret. Retrieve it via the settings API.',
    );
  }

  getSecret(): string {
    return this.secret;
  }

  private async tryLoadFromFile(): Promise<string | null> {
    const dataDir = process.env.APP_DATA_DIR?.trim();
    if (!dataDir) return null;
    const filePath = join(dataDir, WebhookSecretService.SECRET_FILENAME);
    try {
      const content = await readFile(filePath, 'utf8');
      await chmod(filePath, 0o600).catch(() => undefined);
      const trimmed = content.trim();
      return trimmed || null;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT') return null;
      this.logger.warn(
        `Failed to load persisted webhook secret: ${(err as Error)?.message ?? String(err)}`,
      );
      return null;
    }
  }

  private async persistToFile(secret: string): Promise<void> {
    const dataDir = process.env.APP_DATA_DIR?.trim();
    if (!dataDir) return;
    const filePath = join(dataDir, WebhookSecretService.SECRET_FILENAME);
    try {
      await writeFile(filePath, secret, { encoding: 'utf8', mode: 0o600 });
      await chmod(filePath, 0o600).catch(() => undefined);
    } catch (err) {
      this.logger.warn(
        `Failed to persist webhook secret: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}
