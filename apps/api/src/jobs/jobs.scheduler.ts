import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../db/prisma.service';
import { JOB_DEFINITIONS, findJobDefinition } from './job-registry';
import { JobsService } from './jobs.service';

const REGISTRY_PREFIX = 'job:';
const UNSCHEDULABLE_JOB_IDS = new Set<string>([
  // Webhook/manual-input jobs (no schedule support)
  'mediaAddedCleanup',
  'immaculateTastePoints',
  'watchedMovieRecommendations',
  // One-time startup migration (no schedule support)
  'collectionResyncUpgrade',
]);

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
    if (UNSCHEDULABLE_JOB_IDS.has(jobId)) {
      throw new BadRequestException(
        `Job ${jobId} is webhook-only and cannot be scheduled`,
      );
    }

    // Validate cron by constructing a job (won't start)
    try {
      const validationJob = new CronJob(
        cron,
        () => undefined,
        null,
        false,
        timezone ?? undefined,
      );
      validationJob.stop();
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
      where: {
        enabled: true,
        jobId: { notIn: Array.from(UNSCHEDULABLE_JOB_IDS) },
      },
    });

    for (const schedule of enabledSchedules) {
      const { jobId, cron, timezone } = schedule;
      const name = `${REGISTRY_PREFIX}${jobId}`;

      try {
        const job = new CronJob(
          cron,
          async () => {
            try {
              // Defensive: schedules can be toggled/disabled by other code paths (e.g. first-admin setup).
              // If the DB says it's disabled, do not run even if a CronJob is still registered.
              const stillEnabled = await this.prisma.jobSchedule.findUnique({
                where: { jobId },
                select: { enabled: true },
              });
              if (!stillEnabled?.enabled) {
                // The DB is the source of truth. If a schedule is disabled while a CronJob is still
                // registered (e.g. settings-driven enforcement), skip and remove it to avoid future ticks.
                this.logger.debug(
                  `Skipping scheduled run; schedule disabled jobId=${jobId}`,
                );
                try {
                  job.stop();
                } catch {
                  // ignore
                }
                try {
                  this.schedulerRegistry.deleteCronJob(name);
                } catch {
                  // ignore
                }
                return;
              }

              const user = await this.prisma.user.findFirst({
                orderBy: { createdAt: 'asc' },
                select: { id: true },
              });
              const userId = user?.id;
              if (!userId) {
                this.logger.warn(
                  `Skipping scheduled run; no admin user exists jobId=${jobId}`,
                );
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
        this.logger.log(
          `Scheduled ${jobId} cron=${cron} tz=${timezone ?? 'local'}`,
        );
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

    // If we tweak defaults over time, gently migrate existing schedules that were
    // never customized (i.e., still on the old default cron).
    //
    // We intentionally DO NOT override user-edited crons; we only change known
    // previous defaults for specific job IDs.
    const defaultCronMigrations: Array<{ jobId: string; from: string; to: string }> = [
      // Monitor Confirm default moved from 3am -> 1am
      { jobId: 'monitorConfirm', from: '0 3 * * *', to: '0 1 * * *' },
      // Based on Latest Watched Refresher default moved from 1am -> 2am
      { jobId: 'recentlyWatchedRefresher', from: '0 1 * * *', to: '0 2 * * *' },
    ];

    const migrationUpdates = await Promise.all(
      defaultCronMigrations.map((m) =>
        this.prisma.jobSchedule.updateMany({
          where: {
            jobId: m.jobId,
            cron: m.from,
          },
          data: { cron: m.to },
        }),
      ),
    );
    const migratedCount = migrationUpdates.reduce((sum, r) => sum + r.count, 0);

    const toCreate = JOB_DEFINITIONS.flatMap((j) => {
      if (!j.defaultScheduleCron || existingIds.has(j.id)) return [];
      return [
        {
          jobId: j.id,
          cron: j.defaultScheduleCron,
          enabled: false,
          timezone: null as string | null,
        },
      ];
    });

    if (!toCreate.length && migratedCount === 0) return;

    if (toCreate.length) {
      await this.prisma.jobSchedule.createMany({ data: toCreate });
    }

    this.logger.log(
      `Default schedules ensured: seeded=${toCreate.length} migrated=${migratedCount}`,
    );
  }
}
