import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import { ImmaculateTasteService } from '../immaculate-taste/immaculate-taste.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

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
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(baseUrl);
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

@Injectable()
export class ImmaculateTasteRefresherJob {
  private static readonly COLLECTION_NAME = 'Inspired by your Immaculate Taste';

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexCurated: PlexCuratedCollectionsService,
    private readonly immaculateTaste: ImmaculateTasteService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const limitRaw = typeof input['limit'] === 'number' ? input['limit'] : null;
    const limit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.max(1, Math.trunc(limitRaw))
        : null;

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const movieLibraryName =
      pickString(settings, 'plex.movieLibraryName') ||
      pickString(settings, 'plex.movie_library_name') ||
      'Movies';

    const movieSectionKey = await this.plexServer.findSectionKeyByTitle({
      baseUrl: plexBaseUrl,
      token: plexToken,
      title: movieLibraryName,
    });
    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });

    const maxPoints =
      Math.trunc(pickNumber(settings, 'immaculateTaste.maxPoints') ?? 50) || 50;

    await ctx.info('immaculateTasteRefresher: start', {
      dryRun: ctx.dryRun,
      movieLibraryName,
      collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
      maxPoints,
      limit,
    });

    await this.immaculateTaste.ensureLegacyImported({ ctx, maxPoints });

    const movies = await this.prisma.immaculateTasteMovie.findMany({
      where: { points: { gt: 0 } },
      select: { ratingKey: true, title: true, points: true },
    });

    if (!movies.length) {
      await ctx.warn('immaculateTasteRefresher: no points rows found (skipping)', {
        collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
      });
      return { summary: { skipped: true, reason: 'no_points_rows' } };
    }

    const order = this.immaculateTaste.buildTieredRandomOrder({
      movies,
      maxPoints,
    });

    const titleByKey = new Map(
      movies.map((m) => [
        m.ratingKey,
        (m.title ?? '').trim() || m.ratingKey,
      ]),
    );

    const desiredItems = order.map((ratingKey) => ({
      ratingKey,
      title: titleByKey.get(ratingKey) ?? ratingKey,
    }));

    const desiredLimited =
      limit && desiredItems.length > limit ? desiredItems.slice(0, limit) : desiredItems;

    if (desiredLimited.length !== desiredItems.length) {
      await ctx.warn('immaculateTasteRefresher: applying limit (manual test)', {
        limit,
        totalAvailable: desiredItems.length,
        totalApplying: desiredLimited.length,
      });
    }

    await ctx.info('immaculateTasteRefresher: built order', {
      total: desiredLimited.length,
      sampleTop10: desiredLimited.slice(0, 10).map((d) => d.title),
    });

    // Persist snapshot to curated collections (replace items)
    let dbSaved = false;
    let curatedCollectionId: string | null = null;
    if (!ctx.dryRun) {
      const col = await this.prisma.curatedCollection.upsert({
        where: { name: ImmaculateTasteRefresherJob.COLLECTION_NAME },
        update: {},
        create: { name: ImmaculateTasteRefresherJob.COLLECTION_NAME },
        select: { id: true },
      });
      curatedCollectionId = col.id;

      await this.prisma.curatedCollectionItem.deleteMany({
        where: { collectionId: col.id },
      });

      const batches = chunk(desiredLimited, 200);
      for (const batch of batches) {
        await this.prisma.curatedCollectionItem.createMany({
          data: batch.map((it) => ({
            collectionId: col.id,
            ratingKey: it.ratingKey,
            title: it.title,
          })),
        });
      }

      dbSaved = true;
      await ctx.info('immaculateTasteRefresher: db snapshot saved', {
        curatedCollectionId,
        savedItems: desiredLimited.length,
      });
    }

    // Rebuild Plex collection (delete → create → order → artwork → pin)
    const plex = ctx.dryRun
      ? null
      : await this.plexCurated.rebuildMovieCollection({
          ctx,
          baseUrl: plexBaseUrl,
          token: plexToken,
          machineIdentifier,
          movieSectionKey,
          collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
          desiredItems: desiredLimited,
          randomizeOrder: false,
        });

    const summary: JsonObject = {
      collectionName: ImmaculateTasteRefresherJob.COLLECTION_NAME,
      totalDesired: desiredLimited.length,
      dbSaved,
      curatedCollectionId,
      plex,
      sampleTop10: desiredLimited.slice(0, 10).map((d) => d.title),
    };

    await ctx.info('immaculateTasteRefresher: done', summary);
    return { summary };
  }
}


