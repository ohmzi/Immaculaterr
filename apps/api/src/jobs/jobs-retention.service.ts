import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class JobsRetentionService implements OnModuleInit {
  private readonly logger = new Logger(JobsRetentionService.name);

  // Keep execution history for 90 days.
  private static readonly RETENTION_DAYS = 90;
  private static readonly INTERVAL_MS = 24 * 60 * 60_000; // daily
  private static readonly BATCH_SIZE = 1000;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Run once shortly after startup.
    setTimeout(() => void this.cleanupOnce(), 20_000);
  }

  @Interval(JobsRetentionService.INTERVAL_MS)
  async poll() {
    await this.cleanupOnce();
  }

  private async cleanupOnce() {
    const cutoff = new Date(
      Date.now() -
        JobsRetentionService.RETENTION_DAYS * 24 * 60 * 60_000,
    );

    let totalRuns = 0;
    let totalLogs = 0;
    let batches = 0;

    try {
      // Delete in batches to avoid large queries.
      // We delete logs explicitly (even though FK cascade should handle it) to be safe.
      for (;;) {
        const runs = await this.prisma.jobRun.findMany({
          where: { startedAt: { lt: cutoff } },
          select: { id: true },
          take: JobsRetentionService.BATCH_SIZE,
        });
        if (!runs.length) break;

        const ids = runs.map((r) => r.id);
        const [logsRes, runsRes] = await this.prisma.$transaction([
          this.prisma.jobLogLine.deleteMany({ where: { runId: { in: ids } } }),
          this.prisma.jobRun.deleteMany({ where: { id: { in: ids } } }),
        ]);

        totalLogs += logsRes.count;
        totalRuns += runsRes.count;
        batches += 1;

        // Safety: avoid an infinite loop in weird DB states.
        if (runsRes.count === 0 || batches > 500) break;
      }

      if (totalRuns > 0 || totalLogs > 0) {
        this.logger.log(
          `Rewind retention: deleted runs=${totalRuns} logs=${totalLogs} cutoff=${cutoff.toISOString()}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Rewind retention failed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}



