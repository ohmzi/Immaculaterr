import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';
import type { JsonObject } from './jobs.types';

type RunJobBody = {
  dryRun?: unknown;
  input?: unknown;
};

type UpsertScheduleBody = {
  cron?: unknown;
  enabled?: unknown;
  timezone?: unknown;
};

@Controller('jobs')
@ApiTags('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly jobsScheduler: JobsScheduler,
  ) {}

  @Get()
  listJobs() {
    return this.jobsService.listJobsWithSchedules().then((jobs) => ({ jobs }));
  }

  @Post(':jobId/run')
  async runJob(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body() body: RunJobBody,
  ) {
    const userId = user.id;
    const dryRun = Boolean(body?.dryRun);
    const inputRaw = body?.input;
    const input: JsonObject | undefined =
      inputRaw === undefined
        ? undefined
        : inputRaw && typeof inputRaw === 'object' && !Array.isArray(inputRaw)
          ? (inputRaw as JsonObject)
          : undefined;

    if (inputRaw !== undefined && !input) {
      throw new BadRequestException('input must be a JSON object');
    }
    const run = await this.jobsService.runJob({
      jobId,
      trigger: 'manual',
      dryRun,
      userId,
      input,
    });
    return { ok: true, run };
  }

  @Get('runs')
  async listRuns(
    @CurrentUser() user: AuthUser,
    @Query('jobId') jobId?: string,
    @Query('take') takeRaw?: string,
    @Query('skip') skipRaw?: string,
  ) {
    const userId = user.id;
    const take = Math.max(
      1,
      Math.min(200, Number.parseInt(takeRaw ?? '50', 10) || 50),
    );
    const skip = Math.max(0, Number.parseInt(skipRaw ?? '0', 10) || 0);
    const runs = await this.jobsService.listRuns({ userId, jobId, take, skip });
    return { runs };
  }

  @Delete('runs')
  async clearRuns(
    @CurrentUser() user: AuthUser,
    @Query('jobId') jobIdRaw?: string,
  ) {
    const userId = user.id;
    const jobId =
      typeof jobIdRaw === 'string' && jobIdRaw.trim()
        ? jobIdRaw.trim()
        : undefined;
    const result = await this.jobsService.clearRuns({ userId, jobId });
    return { ok: true, ...result };
  }

  @Get('runs/:runId')
  async getRun(
    @CurrentUser() user: AuthUser,
    @Param('runId') runId: string,
  ) {
    const userId = user.id;
    const run = await this.jobsService.getRun({ userId, runId });
    return { run };
  }

  @Get('runs/:runId/logs')
  async getRunLogs(
    @CurrentUser() user: AuthUser,
    @Param('runId') runId: string,
    @Query('take') takeRaw?: string,
    @Query('skip') skipRaw?: string,
  ) {
    const userId = user.id;
    const take = Math.max(
      1,
      Math.min(1000, Number.parseInt(takeRaw ?? '500', 10) || 500),
    );
    const skip = Math.max(0, Number.parseInt(skipRaw ?? '0', 10) || 0);
    const logs = await this.jobsService.getRunLogs({
      userId,
      runId,
      take,
      skip,
    });
    return { logs };
  }

  @Put('schedules/:jobId')
  async upsertSchedule(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body() body: UpsertScheduleBody,
  ) {
    const cron = typeof body?.cron === 'string' ? body.cron.trim() : '';
    const enabled = body?.enabled === undefined ? true : Boolean(body.enabled);
    const timezone =
      typeof body?.timezone === 'string' && body.timezone.trim()
        ? body.timezone.trim()
        : null;

    if (!cron) throw new BadRequestException('cron is required');

    this.logger.log(
      `Schedule update: jobId=${JSON.stringify(jobId)} userId=${user.id} enabled=${enabled}`,
    );

    const schedule = await this.jobsScheduler.upsertSchedule({
      jobId,
      cron,
      enabled,
      timezone,
    });

    return { ok: true, schedule };
  }
}
