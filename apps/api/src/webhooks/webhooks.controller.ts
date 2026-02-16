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
import { isPlexLibrarySectionExcluded } from '../plex/plex-library-selection.utils';
import { isPlexUserExcludedFromMonitoring } from '../plex/plex-user-selection.utils';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
import { normalizeTitleForMatching } from '../lib/title-normalize';
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
    private readonly plexUsers: PlexUsersService,
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

    // Normalize Plex titles early (persist + downstream jobs).
    const payloadObj = isPlainObject(payload) ? payload : null;
    if (payloadObj) {
      const metaRaw = pick(payloadObj, 'Metadata');
      const meta = isPlainObject(metaRaw) ? metaRaw : null;
      if (meta) {
        const fields = [
          'title',
          'grandparentTitle',
          'parentTitle',
          'originalTitle',
          'librarySectionTitle',
        ] as const;
        for (const k of fields) {
          const v = meta[k];
          if (typeof v === 'string' && v.trim()) {
            meta[k] = normalizeTitleForMatching(v);
          }
        }
      }
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

    // Trigger watched automation on scrobble(movie|episode).
    // NOTE: Plex webhooks can be noisy; we keep the conditions strict.
    const plexEvent = payloadObj ? pickString(payloadObj, 'event') : '';
    const mediaType = payloadObj ? pickString(payloadObj, 'Metadata.type') : '';

    const mediaTypeLower = mediaType.toLowerCase();

    if (
      plexEvent === 'media.scrobble' &&
      (mediaTypeLower === 'movie' || mediaTypeLower === 'episode')
    ) {
      const showTitle =
        mediaTypeLower === 'episode' && payloadObj
          ? pickString(payloadObj, 'Metadata.grandparentTitle')
          : '';
      const episodeTitle =
        mediaTypeLower === 'episode' && payloadObj
          ? pickString(payloadObj, 'Metadata.title')
          : '';

      // For TV, we use the SHOW title as the seed (not the episode title).
      const seedTitle =
        mediaTypeLower === 'episode' ? showTitle : payloadObj ? pickString(payloadObj, 'Metadata.title') : '';

      const seedRatingKey = payloadObj ? pickString(payloadObj, 'Metadata.ratingKey') : '';
      const showRatingKey =
        mediaTypeLower === 'episode' && payloadObj
          ? pickString(payloadObj, 'Metadata.grandparentRatingKey')
          : '';
      const seasonNumber =
        mediaTypeLower === 'episode' && payloadObj
          ? pickNumber(payloadObj, 'Metadata.parentIndex')
          : null;
      const episodeNumber =
        mediaTypeLower === 'episode' && payloadObj
          ? pickNumber(payloadObj, 'Metadata.index')
          : null;

      const seedYear =
        mediaTypeLower === 'movie' && payloadObj
          ? pickNumber(payloadObj, 'Metadata.year')
          : null;
      const seedLibrarySectionId = payloadObj
        ? pickNumber(payloadObj, 'Metadata.librarySectionID')
        : null;
      const seedLibrarySectionTitle = payloadObj
        ? pickString(payloadObj, 'Metadata.librarySectionTitle')
        : '';
      const plexAccountId = payloadObj ? pickNumber(payloadObj, 'Account.id') : null;
      const plexAccountTitle = payloadObj
        ? pickString(payloadObj, 'Account.title') ||
          pickString(payloadObj, 'Account.name') ||
          pickString(payloadObj, 'user') ||
          pickString(payloadObj, 'owner')
        : '';

      if (seedTitle) {
        const userId = await this.authService.getFirstAdminUserId();
        if (userId) {
          try {
            const plexUser = await this.plexUsers.resolvePlexUser({
              plexAccountId,
              plexAccountTitle,
              userId,
            });
            const plexUserId = plexUser.id;
            const plexUserTitle = plexUser.plexAccountTitle;
            const resolvedPlexAccountId = plexUser.plexAccountId ?? plexAccountId ?? null;
            const resolvedPlexAccountTitle = plexUserTitle || plexAccountTitle || null;

            const payloadInput = {
              source: 'plexWebhook',
              plexEvent,
              plexUserId,
              plexUserTitle,
              plexAccountId: resolvedPlexAccountId,
              plexAccountTitle: resolvedPlexAccountTitle,
              mediaType: mediaTypeLower,
              seedTitle,
              seedYear: seedYear ?? null,
              seedRatingKey: seedRatingKey || null,
              seedLibrarySectionId: seedLibrarySectionId ?? null,
              seedLibrarySectionTitle: seedLibrarySectionTitle || null,
              ...(mediaTypeLower === 'episode'
                ? {
                    showTitle: showTitle || null,
                    showRatingKey: showRatingKey || null,
                    seasonNumber: seasonNumber ?? null,
                    episodeNumber: episodeNumber ?? null,
                    episodeTitle: episodeTitle || null,
                  }
                : {}),
              persistedPath: persisted.path,
            } as const;

            const runs: Record<string, string> = {};
            const errors: Record<string, string> = {};
            const skipped: Record<string, string> = {};

            const { settings } = await this.settingsService
              .getInternalSettings(userId)
              .catch(() => ({
                settings: {} as Record<string, unknown>,
                secrets: {},
              }));
            const userMonitoringExcluded = isPlexUserExcludedFromMonitoring({
              settings,
              plexUserId,
            });
            if (userMonitoringExcluded) {
              skipped.watchedMovieRecommendations = 'user_toggled_off_by_admin';
              skipped.immaculateTastePoints = 'user_toggled_off_by_admin';
              this.webhooksService.logPlexUserMonitoringSkipped({
                source: 'plexWebhook',
                plexEvent,
                mediaType,
                plexUserId,
                plexUserTitle,
                seedTitle,
              });
              this.webhooksService.logPlexWebhookAutomation({
                plexEvent,
                mediaType,
                seedTitle,
                plexUserId,
                plexUserTitle,
                skipped,
              });
              return {
                ok: true,
                ...persisted,
                triggered: false,
                skipped,
              };
            }

            // Respect per-job webhook auto-run toggles (default: disabled)
            const watchedEnabled =
              pickBool(
                settings,
                'jobs.webhookEnabled.watchedMovieRecommendations',
              ) ?? false;
            const immaculateEnabled =
              pickBool(settings, 'jobs.webhookEnabled.immaculateTastePoints') ??
              false;
            const seedLibrarySectionKey =
              seedLibrarySectionId !== null
                ? String(Math.trunc(seedLibrarySectionId))
                : '';
            const seedLibraryExcluded =
              seedLibrarySectionKey &&
              isPlexLibrarySectionExcluded({
                settings,
                sectionKey: seedLibrarySectionKey,
              });

            // 1) Recently-watched recommendations (two collections)
            // NOTE: polling-only mode (70% progress) - do not trigger from webhooks.
            // Plex webhooks are still persisted/logged for auditability.
            skipped.watchedMovieRecommendations = watchedEnabled
              ? 'polling_only'
              : 'disabled';

            // 2) Immaculate Taste points update (dataset grows/decays over time)
            if (!immaculateEnabled) {
              skipped.immaculateTastePoints = 'disabled';
            } else if (seedLibraryExcluded) {
              skipped.immaculateTastePoints = 'library_excluded';
            } else {
              try {
                const run = await this.jobsService.runJob({
                  jobId: 'immaculateTastePoints',
                  trigger: 'auto',
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
              plexUserId,
              plexUserTitle,
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
          pickBool(settings, 'jobs.webhookEnabled.mediaAddedCleanup') ?? false;

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
            trigger: 'auto',
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
