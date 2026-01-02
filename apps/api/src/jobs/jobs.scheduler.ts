import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../db/prisma.service';
import { JOB_DEFINITIONS, findJobDefinition } from './job-registry';
import { JobsService } from './jobs.service';

const REGISTRY_PREFIX = 'job:';

@Injectable()
export class JobsScheduler implements OnModuleInit {
  private readonly logger = new Logger(JobsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly jobsService: JobsService,
  ) {}

  async onModuleInit() {
    if (process.env.SCHEDULER_ENABLED === 'false') {
      this.logger.warn('Scheduler disabled via SCHEDULER_ENABLED=false');
      return;
    }
    await this.ensureDefaultSchedules();
    await this.refreshSchedules();
  }

  async upsertSchedule(params: {
    jobId: string;
    cron: string;
    enabled: boolean;
    timezone?: string | null;
  }) {
    const { jobId, cron, enabled, timezone } = params;
    if (!findJobDefinition(jobId)) {
      throw new BadRequestException(`Unknown job: ${jobId}`);
    }

    // Validate cron by constructing a job (won't start)
    try {
      // eslint-disable-next-line no-new
      new CronJob(cron, () => undefined, null, false, timezone ?? undefined);
    } catch (err) {
      throw new BadRequestException(
        `Invalid cron expression: ${(err as Error)?.message ?? String(err)}`,
      );
    }

    const schedule = await this.prisma.jobSchedule.upsert({
      where: { jobId },
      update: { cron, enabled, timezone: timezone ?? null },
      create: { jobId, cron, enabled, timezone: timezone ?? null },
    });

    await this.refreshSchedules();
    return schedule;
  }

  async refreshSchedules() {
    this.clearManagedCronJobs();

    const enabledSchedules = await this.prisma.jobSchedule.findMany({
      where: { enabled: true },
    });

    for (const schedule of enabledSchedules) {
      const { jobId, cron, timezone } = schedule;
      const name = `${REGISTRY_PREFIX}${jobId}`;

      try {
        const job = new CronJob(
          cron,
          async () => {
            try {
              const user = await this.prisma.user.findFirst({
                orderBy: { createdAt: 'asc' },
                select: { id: true },
              });
              const userId = user?.id;
              if (!userId) {
                this.logger.warn(`Skipping scheduled run; no admin user exists jobId=${jobId}`);
                return;
              }
              await this.jobsService.runJob({
                jobId,
                trigger: 'schedule',
                dryRun: false,
                userId,
              });
            } catch (err) {
              this.logger.error(
                `Scheduled job failed jobId=${jobId}: ${(err as Error)?.message ?? String(err)}`,
              );
            }
          },
          null,
          false,
          timezone ?? undefined,
        );

        this.schedulerRegistry.addCronJob(name, job);
        job.start();
        this.logger.log(`Scheduled ${jobId} cron=${cron} tz=${timezone ?? 'local'}`);
      } catch (err) {
        this.logger.error(
          `Failed to schedule jobId=${jobId} cron=${cron}: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }
  }

  private clearManagedCronJobs() {
    for (const [name] of this.schedulerRegistry.getCronJobs()) {
      if (!name.startsWith(REGISTRY_PREFIX)) continue;
      try {
        this.schedulerRegistry.deleteCronJob(name);
      } catch {
        // ignore
      }
    }
  }

  private async ensureDefaultSchedules() {
    const existing = await this.prisma.jobSchedule.findMany();
    const existingIds = new Set(existing.map((s) => s.jobId));

    const toCreate = JOB_DEFINITIONS.filter(
      (j) => j.defaultScheduleCron && !existingIds.has(j.id),
    ).map((j) => ({
      jobId: j.id,
      cron: j.defaultScheduleCron!,
      enabled: false,
      timezone: null as string | null,
    }));

    if (!toCreate.length) return;

    await this.prisma.jobSchedule.createMany({ data: toCreate });
    this.logger.log(`Seeded ${toCreate.length} default schedules (disabled).`);
  }
}


