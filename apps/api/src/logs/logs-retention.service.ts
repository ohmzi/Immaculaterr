import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { pruneServerLogsOlderThan } from './server-logs.store';

@Injectable()
export class LogsRetentionService implements OnModuleInit {
  private readonly logger = new Logger(LogsRetentionService.name);

  private static readonly RETENTION_DAYS = 15;
  private static readonly INTERVAL_MS = 24 * 60 * 60_000; // daily

  onModuleInit() {
    setTimeout(() => void this.cleanupOnce(), 15_000);
  }

  @Interval(LogsRetentionService.INTERVAL_MS)
  async poll() {
    this.cleanupOnce();
  }

  private cleanupOnce() {
    const cutoff = new Date(
      Date.now() - LogsRetentionService.RETENTION_DAYS * 24 * 60 * 60_000,
    );
    const res = pruneServerLogsOlderThan(cutoff);
    if (res.removed > 0) {
      this.logger.log(
        `Server logs retention: removed=${res.removed} kept=${res.kept} cutoff=${cutoff.toISOString()}`,
      );
    }
  }
}



