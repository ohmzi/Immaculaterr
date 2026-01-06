import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { Public } from '../auth/public.decorator';
import { JobsService } from '../jobs/jobs.service';
import { PlexAnalyticsService } from '../plex/plex-analytics.service';
import { SettingsService } from '../settings/settings.service';
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

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
}

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly jobsService: JobsService,
    private readonly authService: AuthService,
    private readonly settingsService: SettingsService,
    private readonly plexAnalytics: PlexAnalyticsService,
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
    @Req() req: Request,
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
    this.webhooksService.logPlexWebhookSummary({
      payload,
      persistedPath: persisted.path,
      receivedAtIso: event.receivedAt,
      files: event.files,
      source: {
        ip: req.ip ?? null,
        userAgent:
          typeof req.headers['user-agent'] === 'string'
            ? req.headers['user-agent']
            : null,
      },
    });

    // Trigger watched-movie automation on scrobble(movie).
    // NOTE: Plex webhooks can be noisy; we keep the conditions strict.
    const payloadObj = isPlainObject(payload) ? payload : null;
    const plexEvent = payloadObj ? pickString(payloadObj, 'event') : '';
    const mediaType = payloadObj ? pickString(payloadObj, 'Metadata.type') : '';

    if (plexEvent === 'media.scrobble' && mediaType.toLowerCase() === 'movie') {
      const seedTitle = payloadObj
        ? pickString(payloadObj, 'Metadata.title')
        : '';
      const seedRatingKey = payloadObj
        ? pickString(payloadObj, 'Metadata.ratingKey')
        : '';
      const seedYear = payloadObj
        ? pickNumber(payloadObj, 'Metadata.year')
        : null;
      const seedLibrarySectionId = payloadObj
        ? pickNumber(payloadObj, 'Metadata.librarySectionID')
        : null;
      const seedLibrarySectionTitle = payloadObj
        ? pickString(payloadObj, 'Metadata.librarySectionTitle')
        : '';

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
              seedLibrarySectionId: seedLibrarySectionId ?? null,
              seedLibrarySectionTitle: seedLibrarySectionTitle || null,
              persistedPath: persisted.path,
            } as const;

            const runs: Record<string, string> = {};
            const errors: Record<string, string> = {};
            const skipped: Record<string, string> = {};

            // Respect per-job webhook auto-run toggles (default: enabled)
            const { settings } = await this.settingsService
              .getInternalSettings(userId)
              .catch(() => ({
                settings: {} as Record<string, unknown>,
                secrets: {},
              }));
            const watchedEnabled =
              pickBool(
                settings,
                'jobs.webhookEnabled.watchedMovieRecommendations',
              ) ?? true;
            const immaculateEnabled =
              pickBool(settings, 'jobs.webhookEnabled.immaculateTastePoints') ??
              true;

            // 1) Recently-watched recommendations (two collections)
            if (!watchedEnabled) {
              skipped.watchedMovieRecommendations = 'disabled';
            } else {
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
            }

            // 2) Immaculate Taste points update (dataset grows/decays over time)
            if (!immaculateEnabled) {
              skipped.immaculateTastePoints = 'disabled';
            } else {
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
                errors.immaculateTastePoints =
                  (err as Error)?.message ?? String(err);
              }
            }

            const triggered = Object.keys(runs).length > 0;
            this.webhooksService.logPlexWebhookAutomation({
              plexEvent,
              mediaType,
              seedTitle,
              runs,
              ...(Object.keys(skipped).length ? { skipped } : {}),
              ...(Object.keys(errors).length ? { errors } : {}),
            });
            return {
              ok: true,
              ...persisted,
              triggered,
              runs,
              ...(Object.keys(skipped).length ? { skipped } : {}),
              ...(Object.keys(errors).length ? { errors } : {}),
            };
          } catch (err) {
            const msg = (err as Error)?.message ?? String(err);
            this.webhooksService.logPlexWebhookAutomation({
              plexEvent,
              mediaType,
              seedTitle,
              errors: { webhook: msg },
            });
            return { ok: true, ...persisted, triggered: false, error: msg };
          }
        }
      }
    }

    // Trigger post-add cleanup automation on library.new for supported media types.
    if (
      plexEvent === 'library.new' &&
      ['movie', 'show', 'season', 'episode'].includes(mediaType.toLowerCase())
    ) {
      const title = payloadObj ? pickString(payloadObj, 'Metadata.title') : '';
      const ratingKey = payloadObj
        ? pickString(payloadObj, 'Metadata.ratingKey')
        : '';
      const year = payloadObj ? pickNumber(payloadObj, 'Metadata.year') : null;
      const grandparentTitle = payloadObj
        ? pickString(payloadObj, 'Metadata.grandparentTitle')
        : '';
      const grandparentRatingKey = payloadObj
        ? pickString(payloadObj, 'Metadata.grandparentRatingKey')
        : '';
      const parentIndex = payloadObj
        ? pickNumber(payloadObj, 'Metadata.parentIndex')
        : null;
      const index = payloadObj
        ? pickNumber(payloadObj, 'Metadata.index')
        : null;

      const userId = await this.authService.getFirstAdminUserId();
      if (userId) {
        // New media has been added to Plex; bump the dashboard graph version and clear the
        // server-side growth cache so the next request recomputes quickly.
        this.plexAnalytics.invalidateLibraryGrowth(userId);

        const { settings } = await this.settingsService
          .getInternalSettings(userId)
          .catch(() => ({
            settings: {} as Record<string, unknown>,
            secrets: {},
          }));
        const enabled =
          pickBool(settings, 'jobs.webhookEnabled.mediaAddedCleanup') ?? true;

        if (!enabled) {
          this.webhooksService.logPlexWebhookAutomation({
            plexEvent,
            mediaType,
            seedTitle: title || undefined,
            skipped: { mediaAddedCleanup: 'disabled' },
          });
          return {
            ok: true,
            ...persisted,
            triggered: false,
            skipped: { mediaAddedCleanup: 'disabled' },
          };
        }

        try {
          const input = {
            source: 'plexWebhook',
            plexEvent,
            mediaType: mediaType.toLowerCase(),
            title,
            year: year ?? null,
            ratingKey: ratingKey || null,
            showTitle: grandparentTitle || null,
            showRatingKey: grandparentRatingKey || null,
            seasonNumber: parentIndex ?? null,
            episodeNumber: index ?? null,
            persistedPath: persisted.path,
          } as const;

          const run = await this.jobsService.runJob({
            jobId: 'mediaAddedCleanup',
            trigger: 'manual',
            dryRun: false,
            userId,
            input,
          });

          this.webhooksService.logPlexWebhookAutomation({
            plexEvent,
            mediaType,
            seedTitle: title || undefined,
            runs: { mediaAddedCleanup: run.id },
          });
          return {
            ok: true,
            ...persisted,
            triggered: true,
            runs: { mediaAddedCleanup: run.id },
          };
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          this.webhooksService.logPlexWebhookAutomation({
            plexEvent,
            mediaType,
            seedTitle: title || undefined,
            errors: { mediaAddedCleanup: msg },
          });
          return { ok: true, ...persisted, triggered: false, error: msg };
        }
      }
    }

    return { ok: true, ...persisted, triggered: false };
  }
}
