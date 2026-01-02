import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

@Injectable()
export class RecentlyWatchedRefresherJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const { settings, secrets } = await this.settingsService.getInternalSettings(ctx.userId);

    const plexBaseUrl =
      this.pickString(settings, 'plex.baseUrl') ??
      this.pickString(settings, 'plex.url') ??
      this.requireString(settings, 'plex.baseUrl');
    const plexToken =
      this.pickString(secrets, 'plex.token') ??
      this.pickString(secrets, 'plexToken') ??
      this.requireString(secrets, 'plex.token');

    const movieLibraryName =
      this.pickString(settings, 'plex.movieLibraryName') ??
      this.pickString(settings, 'plex.movie_library_name') ??
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

    const collections = await this.prisma.curatedCollection.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    await ctx.info('recentlyWatchedRefresher: start', {
      dryRun: ctx.dryRun,
      movieLibraryName,
      collections: collections.map((c) => c.name),
    });

    const perCollection: JsonObject[] = [];

    if (!collections.length) {
      await ctx.warn('recentlyWatchedRefresher: no curated collections configured', {
        hint: 'Create collections + items in the UI (Collections page), then rerun.',
      });
    }

    for (const col of collections) {
      const colSummary = await this.refreshOneCollection({
        ctx,
        baseUrl: plexBaseUrl,
        token: plexToken,
        machineIdentifier,
        movieSectionKey,
        collectionId: col.id,
        collectionName: col.name,
      });
      perCollection.push(colSummary);
    }

    const summary: JsonObject = {
      dryRun: ctx.dryRun,
      collections: perCollection,
    };

    await ctx.info('recentlyWatchedRefresher: done', summary);
    return { summary };
  }

  private async refreshOneCollection(params: {
    ctx: JobContext;
    baseUrl: string;
    token: string;
    machineIdentifier: string;
    movieSectionKey: string;
    collectionId: string;
    collectionName: string;
  }): Promise<JsonObject> {
    const { ctx, baseUrl, token, machineIdentifier, movieSectionKey, collectionId, collectionName } =
      params;

    await ctx.info('collection: start', { collectionName, collectionId });

    const items = await this.prisma.curatedCollectionItem.findMany({
      where: { collectionId },
      orderBy: { id: 'asc' },
    });

    if (!items.length) {
      await ctx.warn('collection: no items in DB (skipping)', { collectionName });
      return {
        collectionName,
        dbItems: 0,
        removed: 0,
        added: 0,
        moved: 0,
        skipped: 0,
      };
    }

    const desired = shuffle([...items]).map((i) => ({ ratingKey: i.ratingKey, title: i.title }));

    // Ensure Plex collection exists
    let plexCollectionKey = await this.plexServer.findCollectionRatingKey({
      baseUrl,
      token,
      librarySectionKey: movieSectionKey,
      collectionName,
    });

    if (!plexCollectionKey) {
      await ctx.warn('collection: plex collection not found; creating', { collectionName });
      const first = desired[0]?.ratingKey ?? null;
      await this.plexServer.createCollection({
        baseUrl,
        token,
        machineIdentifier,
        librarySectionKey: movieSectionKey,
        collectionName,
        type: 1,
        initialItemRatingKey: first,
      });

      plexCollectionKey = await this.plexServer.findCollectionRatingKey({
        baseUrl,
        token,
        librarySectionKey: movieSectionKey,
        collectionName,
      });
    }

    if (!plexCollectionKey) {
      throw new Error(`Failed to find or create Plex collection: ${collectionName}`);
    }

    const currentItems = await this.plexServer.getCollectionItems({
      baseUrl,
      token,
      collectionRatingKey: plexCollectionKey,
    });

    if (ctx.dryRun) {
      await ctx.info('collection: dry-run preview', {
        collectionName,
        plexCollectionKey,
        existingCount: currentItems.length,
        desiredCount: desired.length,
      });
      return {
        collectionName,
        dbItems: items.length,
        plexCollectionKey,
        existingCount: currentItems.length,
        desiredCount: desired.length,
        removed: currentItems.length,
        added: desired.length,
        moved: desired.length,
        skipped: 0,
        sample: desired.slice(0, 10).map((d) => d.title),
      };
    }

    // Remove all existing items (best-effort)
    let removed = 0;
    for (const item of currentItems) {
      try {
        await this.plexServer.removeItemFromCollection({
          baseUrl,
          token,
          collectionRatingKey: plexCollectionKey,
          itemRatingKey: item.ratingKey,
        });
        removed += 1;
      } catch (err) {
        await ctx.warn('collection: failed to remove item (continuing)', {
          collectionName,
          ratingKey: item.ratingKey,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    // Add items in randomized order
    let added = 0;
    let skipped = 0;
    for (const item of desired) {
      try {
        await this.plexServer.addItemToCollection({
          baseUrl,
          token,
          machineIdentifier,
          collectionRatingKey: plexCollectionKey,
          itemRatingKey: item.ratingKey,
        });
        added += 1;
      } catch (err) {
        skipped += 1;
        await ctx.warn('collection: failed to add item (continuing)', {
          collectionName,
          ratingKey: item.ratingKey,
          title: item.title,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    // Apply custom order by moving items
    let moved = 0;
    let prev: string | null = null;
    for (const item of desired) {
      try {
        await this.plexServer.moveCollectionItem({
          baseUrl,
          token,
          collectionRatingKey: plexCollectionKey,
          itemRatingKey: item.ratingKey,
          after: prev,
        });
        prev = item.ratingKey;
        moved += 1;
      } catch (err) {
        await ctx.warn('collection: failed to move item (continuing)', {
          collectionName,
          ratingKey: item.ratingKey,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    await ctx.info('collection: done', {
      collectionName,
      removed,
      added,
      moved,
      skipped,
    });

    return {
      collectionName,
      dbItems: items.length,
      plexCollectionKey,
      removed,
      added,
      moved,
      skipped,
      sample: desired.slice(0, 10).map((d) => d.title),
    };
  }

  private pickString(obj: Record<string, unknown>, path: string): string | null {
    const v = this.pick(obj, path);
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return s ? s : null;
  }

  private requireString(obj: Record<string, unknown>, path: string): string {
    const s = this.pickString(obj, path);
    if (!s) throw new Error(`Missing required setting: ${path}`);
    return s;
  }

  private pick(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let cur: unknown = obj;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}


