import { Injectable } from '@nestjs/common';
import type { JobContext, JobRunResult } from './jobs.types';

@Injectable()
export class NoopJob {
  async run(ctx: JobContext): Promise<JobRunResult> {
    await ctx.info('noop: start');
    await ctx.info('noop: done');
    return { summary: { ok: true } };
  }
}
