import { Injectable } from '@nestjs/common';
import type { JobContext, JobRunResult } from './jobs.types';
import { ImportService } from '../import/import.service';

@Injectable()
export class ImportNetflixHistoryJob {
  constructor(private readonly importService: ImportService) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    return await this.importService.processImportedEntries(ctx);
  }
}
