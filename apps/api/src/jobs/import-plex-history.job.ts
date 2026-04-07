import { Injectable } from '@nestjs/common';
import type { JobContext, JobRunResult } from './jobs.types';
import { ImportService } from '../import/import.service';

@Injectable()
export class ImportPlexHistoryJob {
  constructor(private readonly importService: ImportService) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    await this.importService.fetchAndStorePlexHistory(ctx.userId, ctx);
    return await this.importService.processImportedEntries(ctx, 'plex');
  }
}
