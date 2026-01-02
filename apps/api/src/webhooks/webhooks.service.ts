import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  async persistPlexWebhookEvent(event: unknown) {
    const baseDir = join(this.getDataDir(), 'webhooks', 'plex');
    await fs.mkdir(baseDir, { recursive: true });

    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`;
    const path = join(baseDir, filename);

    await fs.writeFile(path, JSON.stringify(event, null, 2), 'utf8');
    this.logger.log(`Persisted Plex webhook event: ${path}`);

    return { path };
  }

  private getDataDir(): string {
    // During dev, npm workspaces runs scripts with cwd = apps/server.
    // This resolves to the repo-root `data/` directory without relying on cwd.
    const repoRoot = join(__dirname, '..', '..', '..', '..');
    return process.env.APP_DATA_DIR ?? join(repoRoot, 'data');
  }
}
