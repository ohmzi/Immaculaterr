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
  // A single chatty run must not balloon the table inside the retention
  // window: finished runs keep at most this many newest log lines.
  private static readonly MAX_LOG_LINES_PER_RUN = 5000;
  private static readonly LOG_CAP_RUN_SCAN_LIMIT = 200;

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
      Date.now() - JobsRetentionService.RETENTION_DAYS * 24 * 60 * 60_000,
    );

    let totalRuns = 0;
    let totalLogs = 0;
    let batches = 0;

    try {
      // Delete in batches to avoid large queries.
      // We delete logs explicitly (even though FK cascade should handle it) to be safe.
      for (;;) {
        const runs = await this.prisma.jobRun.findMany({
          where: {
            status: { in: ['SUCCESS', 'FAILED', 'CANCELLED'] },
            queuedAt: { lt: cutoff },
          },
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

      const cappedLogs = await this.capLogsPerRun();
      if (totalRuns > 0 || totalLogs > 0 || cappedLogs > 0) {
        this.logger.log(
          `Rewind retention: deleted runs=${totalRuns} logs=${totalLogs} capped=${cappedLogs} cutoff=${cutoff.toISOString()}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Rewind retention failed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

  /**
   * Trims finished runs down to the newest MAX_LOG_LINES_PER_RUN lines.
   * Uses a grouped count to find offenders, then deletes everything older
   * than each run's cutoff line.
   */
  private async capLogsPerRun(): Promise<number> {
    let trimmed = 0;
    const offenders = await this.prisma.jobLogLine.groupBy({
      by: ['runId'],
      _count: { runId: true },
      having: {
        runId: {
          _count: { gt: JobsRetentionService.MAX_LOG_LINES_PER_RUN },
        },
      },
      orderBy: { _count: { runId: 'desc' } },
      take: JobsRetentionService.LOG_CAP_RUN_SCAN_LIMIT,
    });
    for (const offender of offenders) {
      const runId = offender.runId;
      const run = await this.prisma.jobRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      // Never trim a live run — its lines are still streaming in.
      if (!run || run.status === 'PENDING' || run.status === 'RUNNING') {
        continue;
      }
      const keepFrom = await this.prisma.jobLogLine.findMany({
        where: { runId },
        orderBy: { id: 'desc' },
        skip: JobsRetentionService.MAX_LOG_LINES_PER_RUN - 1,
        take: 1,
        select: { id: true },
      });
      const cutoffId = keepFrom[0]?.id;
      if (cutoffId === undefined) continue;
      const res = await this.prisma.jobLogLine.deleteMany({
        where: { runId, id: { lt: cutoffId } },
      });
      trimmed += res.count;
    }
    return trimmed;
  }
}
