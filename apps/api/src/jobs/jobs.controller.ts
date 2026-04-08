import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';
import type { JsonObject } from './jobs.types';
import {
  CancelRunDto,
  QueuePauseDto,
  RunJobDto,
  UpsertScheduleDto,
} from './dto/jobs.dto';

@Controller('jobs')
@ApiTags('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly jobsScheduler: JobsScheduler,
    private readonly authService: AuthService,
  ) {}

  @Get()
  listJobs() {
    return this.jobsService.listJobsWithSchedules().then((jobs) => ({ jobs }));
  }

  @Post(':jobId/run')
  async runJob(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body() body: RunJobDto,
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
  async getRun(@CurrentUser() user: AuthUser, @Param('runId') runId: string) {
    const userId = user.id;
    const run = await this.jobsService.getRun({ userId, runId });
    return { run };
  }

  @Post('runs/:runId/cancel')
  async cancelRun(
    @CurrentUser() user: AuthUser,
    @Param('runId') runId: string,
    @Body() body: CancelRunDto,
  ) {
    const run = await this.jobsService.cancelPendingRun({
      userId: user.id,
      runId,
      reason:
        typeof body?.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : undefined,
    });
    return { ok: true, run };
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

  @Get('queue')
  async getQueue(@CurrentUser() user: AuthUser) {
    return await this.jobsService.getQueueSnapshot({ userId: user.id });
  }

  @Post('queue/pause')
  async pauseQueue(@CurrentUser() user: AuthUser, @Body() body: QueuePauseDto) {
    await this.assertAdminUser(user.id);
    const state = await this.jobsService.pauseQueue({
      actorUserId: user.id,
      reason:
        typeof body?.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : undefined,
    });
    return { ok: true, state };
  }

  @Post('queue/resume')
  async resumeQueue(@CurrentUser() user: AuthUser) {
    await this.assertAdminUser(user.id);
    const state = await this.jobsService.resumeQueue({
      actorUserId: user.id,
    });
    return { ok: true, state };
  }

  @Put('schedules/:jobId')
  async upsertSchedule(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body() body: UpsertScheduleDto,
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

  private async assertAdminUser(userId: string) {
    const adminUserId = await this.authService.getFirstAdminUserId();
    if (!adminUserId || adminUserId !== userId) {
      throw new ForbiddenException('Admin access required');
    }
  }
}
