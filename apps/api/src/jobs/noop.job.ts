import { Injectable } from '@nestjs/common';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportV1 } from './job-report-v1';
import { metricRow } from './job-report-v1';

@Injectable()
export class NoopJob {
  async run(ctx: JobContext): Promise<JobRunResult> {
    await ctx.info('noop: start');
    await ctx.info('noop: done');
    const raw: JsonObject = { ok: true };
    const report: JobReportV1 = {
      template: 'jobReportV1',
      version: 1,
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      headline: 'No-op completed.',
      sections: [
        {
          id: 'result',
          title: 'Result',
          rows: [metricRow({ label: 'OK', end: 1, unit: 'yes' })],
        },
      ],
      tasks: [
        {
          id: 'noop',
          title: 'No-op',
          status: 'success',
          rows: [metricRow({ label: 'Completed', end: 1, unit: 'steps' })],
        },
      ],
      issues: [],
      raw,
    };
    return { summary: report as unknown as JsonObject };
  }
}
