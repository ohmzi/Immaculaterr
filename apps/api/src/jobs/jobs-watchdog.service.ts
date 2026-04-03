import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../db/prisma.service';
import { JOB_RUN_TIMEOUT_MS } from '../app.constants';
import { JobsService } from './jobs.service';

@Injectable()
export class JobsWatchdogService {
  private readonly logger = new Logger(JobsWatchdogService.name);

  private static readonly POLL_INTERVAL_MS = 2 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
  ) {}

  @Interval(JobsWatchdogService.POLL_INTERVAL_MS)
  async poll() {
    await this.checkForStuckRuns();
  }

  private async checkForStuckRuns() {
    const cutoff = new Date(Date.now() - JOB_RUN_TIMEOUT_MS);

    try {
      const stuckRuns = await this.prisma.jobRun.findMany({
        where: {
          status: 'RUNNING',
          startedAt: { lt: cutoff },
        },
        select: { id: true, jobId: true, startedAt: true },
      });

      if (!stuckRuns.length) return;

      for (const run of stuckRuns) {
        await this.jobsService.timeoutRunningJob({
          runId: run.id,
          jobId: run.jobId,
          startedAt: run.startedAt,
        });
      }

      this.logger.warn(
        `Watchdog: timed out ${stuckRuns.length} stuck run(s): ${stuckRuns.map((r) => `${r.jobId}#${r.id}`).join(', ')}`,
      );
    } catch (err) {
      this.logger.warn(
        `Watchdog check failed: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}
