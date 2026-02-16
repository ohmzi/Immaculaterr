import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { JobsService } from './jobs.service';
import {
  COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY,
  COLLECTION_RESYNC_UPGRADE_JOB_ID,
} from './collection-resync-upgrade.job';

@Injectable()
export class CollectionResyncUpgradeService implements OnModuleInit {
  private readonly logger = new Logger(CollectionResyncUpgradeService.name);

  private static readonly STARTUP_DELAY_MS = 20_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
  ) {}

  onModuleInit() {
    // Keep startup non-blocking; run shortly after API boot.
    setTimeout(
      () => void this.enqueueUpgradeRun(),
      CollectionResyncUpgradeService.STARTUP_DELAY_MS,
    );
  }

  private async enqueueUpgradeRun() {
    const completed = await this.prisma.setting
      .findUnique({
        where: { key: COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY },
      })
      .catch(() => null);
    const completedAt = completed?.value?.trim() ?? '';
    if (completedAt) {
      this.logger.log(
        `Collection resync upgrade already completed at=${completedAt}; skipping startup run`,
      );
      return;
    }

    const firstUser = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!firstUser?.id) {
      this.logger.log(
        'Collection resync upgrade skipped at startup: no app user exists yet',
      );
      return;
    }

    try {
      const run = await this.jobsService.runJob({
        jobId: COLLECTION_RESYNC_UPGRADE_JOB_ID,
        trigger: 'auto',
        dryRun: false,
        userId: firstUser.id,
      });
      this.logger.log(
        `Collection resync upgrade queued runId=${run.id} userId=${firstUser.id} trigger=auto`,
      );
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      // Best-effort startup orchestration: do not crash boot if migration launch fails.
      this.logger.warn(
        `Collection resync upgrade startup launch skipped: ${message}`,
      );
    }
  }
}
