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
    // Best-effort cleanup of orphaned RUNNING runs from previous process lifetimes.
    setTimeout(() => void this.cleanupOrphanedRunningRuns(), 5_000);
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

  private async cleanupOrphanedRunningRuns() {
    // Approximate process start time using uptime so we only touch runs from a previous process.
    const bootTime = new Date(Date.now() - process.uptime() * 1000);
    const now = new Date();

    try {
      const runs = await this.prisma.jobRun.findMany({
        where: { status: 'RUNNING', startedAt: { lt: bootTime } },
        select: { id: true, jobId: true, startedAt: true },
      });
      if (!runs.length) return;

      const ids = runs.map((r) => r.id);
      const message = `Orphaned RUNNING job detected after restart (bootTime=${bootTime.toISOString()}); marking as FAILED.`;

      const [updateRes, logsRes] = await this.prisma.$transaction([
        this.prisma.jobRun.updateMany({
          where: { id: { in: ids } },
          data: { status: 'FAILED', finishedAt: now, errorMessage: message },
        }),
        this.prisma.jobLogLine.createMany({
          data: runs.map((r) => ({
            runId: r.id,
            level: 'error',
            message,
            context: {
              reason: 'orphaned_running',
              jobId: r.jobId,
              startedAt: r.startedAt.toISOString(),
              bootTime: bootTime.toISOString(),
            },
          })),
        }),
      ]);

      this.logger.warn(
        `Orphaned job runs: marked FAILED runs=${updateRes.count} logs=${logsRes.count} bootTime=${bootTime.toISOString()}`,
      );
    } catch (err) {
      this.logger.warn(
        `Orphaned job run cleanup failed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}



