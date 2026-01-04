import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { AuthService } from '../auth/auth.service';
import { Public } from '../auth/public.decorator';
import { JobsService } from '../jobs/jobs.service';
import { WebhooksService } from './webhooks.service';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function pickNumber(obj: Record<string, unknown>, path: string): number | null {
  const v = pick(obj, path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly jobsService: JobsService,
    private readonly authService: AuthService,
  ) {}

  @Post('plex')
  @Public()
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async plexWebhook(
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    const payloadRaw = body.payload;
    if (typeof payloadRaw !== 'string') {
      throw new BadRequestException('Expected multipart field "payload"');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      throw new BadRequestException('Invalid JSON in "payload" field');
    }

    const event = {
      receivedAt: new Date().toISOString(),
      payload,
      files: (files ?? []).map((f) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      })),
    };

    const persisted = await this.webhooksService.persistPlexWebhookEvent(event);

    // Trigger watched-movie automation on scrobble(movie).
    // NOTE: Plex webhooks can be noisy; we keep the conditions strict.
    const payloadObj = isPlainObject(payload) ? payload : null;
    const plexEvent = payloadObj ? pickString(payloadObj, 'event') : '';
    const mediaType = payloadObj ? pickString(payloadObj, 'Metadata.type') : '';

    if (plexEvent === 'media.scrobble' && mediaType.toLowerCase() === 'movie') {
      const seedTitle = payloadObj ? pickString(payloadObj, 'Metadata.title') : '';
      const seedRatingKey = payloadObj
        ? pickString(payloadObj, 'Metadata.ratingKey')
        : '';
      const seedYear = payloadObj ? pickNumber(payloadObj, 'Metadata.year') : null;

      if (seedTitle) {
        const userId = await this.authService.getFirstAdminUserId();
        if (userId) {
          try {
            const payloadInput = {
              source: 'plexWebhook',
              plexEvent,
              seedTitle,
              seedYear: seedYear ?? null,
              seedRatingKey: seedRatingKey || null,
              persistedPath: persisted.path,
            } as const;

            const runs: Record<string, string> = {};
            const errors: Record<string, string> = {};

            // 1) Recently-watched recommendations (two collections)
            try {
              const run = await this.jobsService.runJob({
                jobId: 'watchedMovieRecommendations',
                trigger: 'manual',
                dryRun: false,
                userId,
                input: payloadInput,
              });
              runs.watchedMovieRecommendations = run.id;
            } catch (err) {
              errors.watchedMovieRecommendations =
                (err as Error)?.message ?? String(err);
            }

            // 2) Immaculate Taste points update (dataset grows/decays over time)
            try {
              const run = await this.jobsService.runJob({
                jobId: 'immaculateTastePoints',
                trigger: 'manual',
                dryRun: false,
                userId,
                input: payloadInput,
              });
              runs.immaculateTastePoints = run.id;
            } catch (err) {
              errors.immaculateTastePoints = (err as Error)?.message ?? String(err);
            }

            const triggered = Object.keys(runs).length > 0;
            return {
              ok: true,
              ...persisted,
              triggered,
              runs,
              ...(Object.keys(errors).length ? { errors } : {}),
            };
          } catch (err) {
            const msg = (err as Error)?.message ?? String(err);
            return { ok: true, ...persisted, triggered: false, error: msg };
          }
        }
      }
    }

    return { ok: true, ...persisted, triggered: false };
  }
}
