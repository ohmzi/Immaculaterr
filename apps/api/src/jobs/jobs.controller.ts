import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JobsScheduler } from './jobs.scheduler';
import { JobsService } from './jobs.service';

type RunJobBody = {
  dryRun?: unknown;
};

type UpsertScheduleBody = {
  cron?: unknown;
  enabled?: unknown;
  timezone?: unknown;
};

@Controller('jobs')
@ApiTags('jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly jobsScheduler: JobsScheduler,
  ) {}

  @Get()
  listJobs() {
    return this.jobsService.listJobsWithSchedules().then((jobs) => ({ jobs }));
  }

  @Post(':jobId/run')
  async runJob(@Req() req: Request, @Param('jobId') jobId: string, @Body() body: RunJobBody) {
    const user = (req as any).user as { id: string } | undefined;
    const userId = user?.id ?? '';
    const dryRun = Boolean(body?.dryRun);
    const run = await this.jobsService.runJob({
      jobId,
      trigger: 'manual',
      dryRun,
      userId,
    });
    return { ok: true, run };
  }

  @Get('runs')
  async listRuns(
    @Req() req: Request,
    @Query('jobId') jobId?: string,
    @Query('take') takeRaw?: string,
    @Query('skip') skipRaw?: string,
  ) {
    const user = (req as any).user as { id: string } | undefined;
    const userId = user?.id ?? '';
    const take = Math.max(1, Math.min(200, Number.parseInt(takeRaw ?? '50', 10) || 50));
    const skip = Math.max(0, Number.parseInt(skipRaw ?? '0', 10) || 0);
    const runs = await this.jobsService.listRuns({ userId, jobId, take, skip });
    return { runs };
  }

  @Get('runs/:runId')
  async getRun(@Req() req: Request, @Param('runId') runId: string) {
    const user = (req as any).user as { id: string } | undefined;
    const userId = user?.id ?? '';
    const run = await this.jobsService.getRun({ userId, runId });
    return { run };
  }

  @Get('runs/:runId/logs')
  async getRunLogs(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Query('take') takeRaw?: string,
    @Query('skip') skipRaw?: string,
  ) {
    const user = (req as any).user as { id: string } | undefined;
    const userId = user?.id ?? '';
    const take = Math.max(1, Math.min(1000, Number.parseInt(takeRaw ?? '500', 10) || 500));
    const skip = Math.max(0, Number.parseInt(skipRaw ?? '0', 10) || 0);
    const logs = await this.jobsService.getRunLogs({ userId, runId, take, skip });
    return { logs };
  }

  @Put('schedules/:jobId')
  async upsertSchedule(
    @Param('jobId') jobId: string,
    @Body() body: UpsertScheduleBody,
  ) {
    const cron = typeof body?.cron === 'string' ? body.cron.trim() : '';
    const enabled = body?.enabled === undefined ? true : Boolean(body.enabled);
    const timezone =
      typeof body?.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : null;

    if (!cron) throw new BadRequestException('cron is required');

    const schedule = await this.jobsScheduler.upsertSchedule({
      jobId,
      cron,
      enabled,
      timezone,
    });

    return { ok: true, schedule };
  }
}


