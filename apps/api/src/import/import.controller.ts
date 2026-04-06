import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SettingsService } from '../settings/settings.service';
import { JobsService } from '../jobs/jobs.service';
import { ImportService } from './import.service';

function pickString(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return '';
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur.trim() : '';
}

@Controller('import')
export class ImportController {
  constructor(
    private readonly importService: ImportService,
    private readonly settingsService: SettingsService,
    private readonly jobsService: JobsService,
  ) {}

  @Post('netflix')
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  async uploadNetflixCsv(
    @Req() req: AuthenticatedRequest,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    if ((files ?? []).length > 1) {
      throw new BadRequestException('Only one file can be uploaded at a time');
    }

    const file = (files ?? [])[0] ?? null;
    if (!file) throw new BadRequestException('CSV file is required');

    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are accepted');
    }

    let result: Awaited<ReturnType<ImportService['parseAndStoreNetflixCsv']>>;
    try {
      result = await this.importService.parseAndStoreNetflixCsv(
        req.user.id,
        file.buffer,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to parse CSV file';
      throw new BadRequestException(msg);
    }

    const warnings: string[] = [];
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(req.user.id);

    const tmdbKey =
      pickString(secrets, 'tmdb.apiKey') ||
      pickString(secrets, 'tmdbApiKey') ||
      pickString(secrets, 'tmdb.api_key');
    if (!tmdbKey) {
      warnings.push(
        'TMDB key not configured. Titles cannot be classified until TMDB is set up.',
      );
    }

    const plexBaseUrl =
      pickString(settings, 'plex.baseUrl') ||
      pickString(settings, 'plexBaseUrl');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrl || !plexToken) {
      warnings.push(
        'Plex not connected. Recommendations will be created once Plex is configured.',
      );
    }

    let jobId: string | null = null;
    const hasWork = await this.importService.hasUnprocessedEntries(req.user.id);

    if (hasWork) {
      try {
        const run = await this.jobsService.runJob({
          jobId: 'importNetflixHistory',
          trigger: 'manual',
          dryRun: false,
          userId: req.user.id,
        });
        jobId = run.id;
      } catch {
        try {
          const queuedRun = await this.jobsService.queueJob({
            jobId: 'importNetflixHistory',
            trigger: 'manual',
            dryRun: false,
            userId: req.user.id,
          });
          jobId = queuedRun.id;
        } catch {
          // Job already queued or running
        }
      }
    }

    const counts = await this.importService.getEntryCounts(req.user.id);

    return {
      totalRawRows: result.totalRawRows,
      totalUnique: result.totalUnique,
      newlyInserted: result.newlyInserted,
      alreadyImported: result.alreadyImported,
      pendingClassification: counts.pending,
      readyToSeed: counts.matched,
      alreadyProcessed: counts.processed,
      jobId,
      warnings,
    };
  }

  @Get('status')
  async getImportStatus(@Req() req: AuthenticatedRequest) {
    return await this.importService.getImportStatus(req.user.id);
  }
}
