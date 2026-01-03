import { Injectable } from '@nestjs/common';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { join } from 'node:path';

const DEFAULT_REFRESH_SOURCES = [
  {
    collectionName: 'Based on your recently watched movie',
    jsonFile: 'recently_watched_collection.json',
  },
  {
    collectionName: 'Change of Taste',
    jsonFile: 'change_of_taste_collection.json',
  },
] as const;

@Injectable()
export class RecentlyWatchedRefresherJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

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

    await ctx.info('recentlyWatchedRefresher: start', {
      dryRun: ctx.dryRun,
      movieLibraryName,
      collections: DEFAULT_REFRESH_SOURCES.map((c) => c.collectionName),
    });

    const perCollection: JsonObject[] = [];

    for (const src of DEFAULT_REFRESH_SOURCES) {
      const colSummary = await this.refreshOneCollectionFromJson({
        ctx,
        baseUrl: plexBaseUrl,
        token: plexToken,
        machineIdentifier,
        movieSectionKey,
        collectionName: src.collectionName,
        jsonFile: src.jsonFile,
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

  private async refreshOneCollectionFromJson(params: {
    ctx: JobContext;
    baseUrl: string;
    token: string;
    machineIdentifier: string;
    movieSectionKey: string;
    collectionName: string;
    jsonFile: string;
  }): Promise<JsonObject> {
    const {
      ctx,
      baseUrl,
      token,
      machineIdentifier,
      movieSectionKey,
      collectionName,
      jsonFile,
    } = params;

    await ctx.info('collection: start', { collectionName, jsonFile });

    const jsonPath = resolveDataFilePath(jsonFile);
    if (!jsonPath) {
      await ctx.warn('collection: JSON file not found (skipping)', {
        collectionName,
        jsonFile,
        hint: 'Expected file under APP_DATA_DIR (where tcp.sqlite lives) or ./data relative to project root.',
      });
      return {
        collectionName,
        source: 'json',
        jsonFile,
        jsonFound: false,
        resolved: 0,
        skipped: 0,
        removed: 0,
        added: 0,
        moved: 0,
      };
    }

    const rawEntries = await this.readCollectionJson(jsonPath);
    if (!rawEntries.length) {
      await ctx.warn('collection: JSON has no items (skipping)', {
        collectionName,
        jsonFile,
        jsonPath,
      });
      return {
        collectionName,
        source: 'json',
        jsonFile,
        jsonFound: true,
        jsonPath,
        resolved: 0,
        skipped: 0,
        removed: 0,
        added: 0,
        moved: 0,
      };
    }

    // Resolve entries to Plex ratingKeys (prefer rating_key; fallback to title search)
    const resolved: Array<{ ratingKey: string; title: string }> = [];
    let skipped = 0;
    for (const entry of rawEntries) {
      const rk = pickRatingKey(entry);
      const title = pickTitle(entry);

      if (rk) {
        resolved.push({ ratingKey: rk, title: title || rk });
        continue;
      }

      if (title) {
        const found = await this.plexServer
          .findMovieRatingKeyByTitle({
            baseUrl,
            token,
            librarySectionKey: movieSectionKey,
            title,
          })
          .catch(() => null);
        if (found) {
          resolved.push({ ratingKey: found.ratingKey, title: found.title });
        } else {
          skipped += 1;
        }
        continue;
      }

      skipped += 1;
    }

    if (!resolved.length) {
      await ctx.warn('collection: no resolvable items from JSON (skipping)', {
        collectionName,
        jsonFile,
        jsonPath,
        totalEntries: rawEntries.length,
        skipped,
      });
      return {
        collectionName,
        source: 'json',
        jsonFile,
        jsonFound: true,
        jsonPath,
        totalEntries: rawEntries.length,
        resolved: 0,
        skipped,
        removed: 0,
        added: 0,
        moved: 0,
      };
    }

    // Deduplicate by ratingKey (keep first title)
    const uniq = new Map<string, string>();
    for (const it of resolved) {
      if (!uniq.has(it.ratingKey)) uniq.set(it.ratingKey, it.title);
    }

    const desired = shuffle(
      Array.from(uniq.entries()).map(([ratingKey, title]) => ({
        ratingKey,
        title,
      })),
    );

    // Ensure Plex collection exists
    let plexCollectionKey = await this.plexServer.findCollectionRatingKey({
      baseUrl,
      token,
      librarySectionKey: movieSectionKey,
      collectionName,
    });

    if (!plexCollectionKey) {
      await ctx.warn('collection: plex collection not found; creating', {
        collectionName,
      });
      const first = desired[0]?.ratingKey ?? null;
      if (!first) {
        await ctx.warn('collection: cannot create Plex collection (no items)', {
          collectionName,
        });
        return {
          collectionName,
          source: 'json',
          jsonFile,
          jsonFound: true,
          jsonPath,
          totalEntries: rawEntries.length,
          resolved: desired.length,
          skipped,
          removed: 0,
          added: 0,
          moved: 0,
        };
      }
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
      throw new Error(
        `Failed to find or create Plex collection: ${collectionName}`,
      );
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
        source: 'json',
        jsonFile,
        jsonFound: true,
        jsonPath,
        totalEntries: rawEntries.length,
        resolved: desired.length,
        plexCollectionKey,
        existingCount: currentItems.length,
        desiredCount: desired.length,
        removed: currentItems.length,
        added: desired.length,
        moved: desired.length,
        skipped,
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

    // Force collection order to 'custom' (required for move operations to reflect in Plex UI)
    try {
      await this.plexServer.setCollectionSort({
        baseUrl,
        token,
        collectionRatingKey: plexCollectionKey,
        sort: 'custom',
      });
    } catch (err) {
      await ctx.warn(
        'collection: failed to set collection sort=custom (continuing)',
        {
          collectionName,
          plexCollectionKey,
          error: (err as Error)?.message ?? String(err),
        },
      );
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

    // Set collection artwork if available (only if items were added or collection exists)
    if (
      plexCollectionKey &&
      (added > 0 || currentItems.length > 0) &&
      !ctx.dryRun
    ) {
      try {
        await ctx.info('collection: setting artwork', { collectionName });
        await this.setCollectionArtwork({
          ctx,
          baseUrl,
          token,
          collectionRatingKey: plexCollectionKey,
          collectionName,
        });
      } catch (err) {
        await ctx.warn('collection: failed to set artwork (non-critical)', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    // Pin collections to home/library (only if items were added or collection exists)
    if (
      plexCollectionKey &&
      (added > 0 || currentItems.length > 0) &&
      !ctx.dryRun
    ) {
      try {
        await ctx.info('collection: pinning to home/library', {
          collectionName,
        });
        await this.pinCuratedCollectionHubs({
          ctx,
          baseUrl,
          token,
          librarySectionKey: movieSectionKey,
        });
      } catch (err) {
        await ctx.warn('collection: failed to pin hubs (non-critical)', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    await ctx.info('collection: done', {
      collectionName,
      jsonFile,
      removed,
      added,
      moved,
      skipped,
    });

    return {
      collectionName,
      source: 'json',
      jsonFile,
      jsonFound: true,
      jsonPath,
      totalEntries: rawEntries.length,
      resolved: desired.length,
      plexCollectionKey,
      removed,
      added,
      moved,
      skipped,
      sample: desired.slice(0, 10).map((d) => d.title),
    };
  }

  private async setCollectionArtwork(params: {
    ctx: JobContext;
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
    collectionName: string;
  }): Promise<void> {
    const { ctx, baseUrl, token, collectionRatingKey, collectionName } = params;

    const artworkPaths = this.getArtworkPaths(collectionName);
    if (!artworkPaths.poster && !artworkPaths.background) {
      await ctx.debug('collection: no artwork files found', { collectionName });
      return;
    }

    if (artworkPaths.poster) {
      try {
        await this.plexServer.uploadCollectionPoster({
          baseUrl,
          token,
          collectionRatingKey,
          filepath: artworkPaths.poster,
        });
        await ctx.info('collection: poster set', {
          collectionName,
          poster: path.basename(artworkPaths.poster),
        });
      } catch (err) {
        await ctx.warn('collection: failed to set poster', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    if (artworkPaths.background) {
      try {
        await this.plexServer.uploadCollectionArt({
          baseUrl,
          token,
          collectionRatingKey,
          filepath: artworkPaths.background,
        });
        await ctx.info('collection: background set', {
          collectionName,
          background: path.basename(artworkPaths.background),
        });
      } catch (err) {
        await ctx.warn('collection: failed to set background', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }
  }

  private async pinCuratedCollectionHubs(params: {
    ctx: JobContext;
    baseUrl: string;
    token: string;
    librarySectionKey: string;
  }): Promise<void> {
    const { ctx, baseUrl, token, librarySectionKey } = params;

    // Order matches Python script: CURATED_RECOMMENDATION_COLLECTION_ORDER
    const collectionOrder = [
      'Based on your recently watched movie',
      'Inspired by your Immaculate Taste',
      'Change of Taste',
    ];

    const stats = {
      requested: collectionOrder.length,
      found: 0,
      updated: 0,
      missing: 0,
      failed: 0,
    };

    // First, set visibility for all collections
    for (const collectionName of collectionOrder) {
      try {
        const collectionKey = await this.plexServer.findCollectionRatingKey({
          baseUrl,
          token,
          librarySectionKey,
          collectionName,
        });

        if (!collectionKey) {
          stats.missing += 1;
          await ctx.debug('hub_pin: collection missing', { collectionName });
          continue;
        }

        stats.found += 1;
        try {
          await this.plexServer.setCollectionHubVisibility({
            baseUrl,
            token,
            librarySectionKey,
            collectionRatingKey: collectionKey,
            promotedToRecommended: 1,
            promotedToOwnHome: 1,
            promotedToSharedHome: 0,
          });
          stats.updated += 1;
          await ctx.info('hub_pin: set visible_on(library,home)=ON', {
            collectionName,
          });
        } catch (err) {
          stats.failed += 1;
          await ctx.warn('hub_pin: failed updating hub settings', {
            collectionName,
            error: (err as Error)?.message ?? String(err),
          });
        }
      } catch (err) {
        stats.failed += 1;
        await ctx.warn('hub_pin: failed loading collection', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    // Now reorder the hubs so they appear as top rows
    try {
      const identifiers: string[] = [];
      const collections: string[] = [];

      for (const collectionName of collectionOrder) {
        try {
          const collectionKey = await this.plexServer.findCollectionRatingKey({
            baseUrl,
            token,
            librarySectionKey,
            collectionName,
          });

          if (!collectionKey) continue;

          const identifier = await this.plexServer.getCollectionHubIdentifier({
            baseUrl,
            token,
            librarySectionKey,
            collectionRatingKey: collectionKey,
          });

          if (identifier) {
            identifiers.push(identifier);
            collections.push(collectionName);
          }
        } catch (err) {
          await ctx.debug('hub_pin: failed to get identifier', {
            collectionName,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }

      if (identifiers.length > 0) {
        // Move first to the top, then chain "after=" for the rest
        const first = identifiers[0];
        await this.plexServer.moveHubRow({
          baseUrl,
          token,
          librarySectionKey,
          identifier: first,
          after: null,
        });

        let prev = first;
        for (let i = 1; i < identifiers.length; i++) {
          await this.plexServer.moveHubRow({
            baseUrl,
            token,
            librarySectionKey,
            identifier: identifiers[i],
            after: prev,
          });
          prev = identifiers[i];
        }

        await ctx.info('hub_pin: reordered top collections', {
          collections,
          identifiers,
        });
      }
    } catch (err) {
      await ctx.warn('hub_pin: reorder failed (non-critical)', {
        error: (err as Error)?.message ?? String(err),
      });
    }

    await ctx.info('hub_pin: done', { stats });
  }

  private getArtworkPaths(collectionName: string): {
    poster: string | null;
    background: string | null;
  } {
    // Map collection names to artwork file names (matches Python script)
    const collectionArtworkMap: Record<string, string> = {
      'Inspired by your Immaculate Taste': 'immaculate_taste_collection',
      'Based on your recently watched movie': 'recently_watched_collection',
      'Change of Taste': 'change_of_taste_collection',
    };

    const artworkName = collectionArtworkMap[collectionName];
    if (!artworkName) {
      return { poster: null, background: null };
    }

    // Find project root by looking for assets/collection_artwork directory
    // Try common layouts relative to current working directory
    const cwd = process.cwd();
    const candidates = [
      join(cwd, 'assets', 'collection_artwork'),
      join(cwd, '..', 'assets', 'collection_artwork'),
      join(cwd, '..', '..', 'assets', 'collection_artwork'),
      join(cwd, '..', '..', '..', 'assets', 'collection_artwork'),
    ];

    let assetsDir: string | null = null;
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        assetsDir = candidate;
        break;
      }
    }

    if (!assetsDir) {
      return { poster: null, background: null };
    }

    // Try .png first, then .jpg
    const posterPng = join(assetsDir, 'posters', `${artworkName}.png`);
    const posterJpg = join(assetsDir, 'posters', `${artworkName}.jpg`);
    const poster = existsSync(posterPng)
      ? posterPng
      : existsSync(posterJpg)
        ? posterJpg
        : null;

    const backgroundPng = join(assetsDir, 'backgrounds', `${artworkName}.png`);
    const backgroundJpg = join(assetsDir, 'backgrounds', `${artworkName}.jpg`);
    const background = existsSync(backgroundPng)
      ? backgroundPng
      : existsSync(backgroundJpg)
        ? backgroundJpg
        : null;

    return { poster, background };
  }

  private async readCollectionJson(jsonPath: string): Promise<unknown[]> {
    const raw = await readFile(jsonPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return isUnknownArray(parsed) ? parsed : [];
  }

  private pickString(
    obj: Record<string, unknown>,
    path: string,
  ): string | null {
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
      if (!cur || typeof cur !== 'object' || Array.isArray(cur))
        return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function resolveDataFilePath(fileName: string): string | null {
  // First try APP_DATA_DIR (the app's configured data directory)
  const appDataDir = process.env['APP_DATA_DIR'];
  if (appDataDir) {
    const candidate = path.resolve(appDataDir, fileName);
    if (existsSync(candidate)) return candidate;
  }

  // Fallback: Try common layouts relative to current working directory
  // - repo root: ./data/<file>
  // - apps/api: ../../data/<file>
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, 'data', fileName),
    path.resolve(cwd, '..', 'data', fileName),
    path.resolve(cwd, '..', '..', 'data', fileName),
    path.resolve(cwd, '..', '..', '..', 'data', fileName),
    path.resolve(cwd, '..', '..', '..', '..', 'data', fileName),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function pickTitle(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim();
  if (!entry || typeof entry !== 'object') return '';
  const titleRaw = (entry as Record<string, unknown>)['title'];
  return typeof titleRaw === 'string' ? titleRaw.trim() : '';
}

function pickRatingKey(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  const obj = entry as Record<string, unknown>;
  const rkRaw = obj['rating_key'] ?? obj['ratingKey'] ?? obj['ratingkey'];
  if (typeof rkRaw === 'string') return rkRaw.trim();
  if (typeof rkRaw === 'number' && Number.isFinite(rkRaw) && rkRaw > 0)
    return String(rkRaw);
  return '';
}
