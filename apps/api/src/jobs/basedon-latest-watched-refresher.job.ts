import { Injectable } from '@nestjs/common';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

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
export class BasedonLatestWatchedRefresherJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexCuratedCollections: PlexCuratedCollectionsService,
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

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const movieSections = sections
      .filter((s) => (s.type ?? '').toLowerCase() === 'movie')
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!movieSections.length) {
      throw new Error('No Plex movie libraries found');
    }

    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });

    await ctx.info('recentlyWatchedRefresher: start', {
      dryRun: ctx.dryRun,
      movieLibraries: movieSections.map((s) => s.title),
      collections: DEFAULT_REFRESH_SOURCES.map((c) => c.collectionName),
    });

    // Build per-library TMDB->ratingKey map once so we can rebuild collections across all libraries.
    const sectionTmdbToItem = new Map<
      string,
      Map<number, { ratingKey: string; title: string }>
    >();
    for (const sec of movieSections) {
      const map = new Map<number, { ratingKey: string; title: string }>();
      const rows = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sec.key,
        sectionTitle: sec.title,
      });
      for (const r of rows) {
        if (!r.tmdbId) continue;
        if (!map.has(r.tmdbId)) map.set(r.tmdbId, { ratingKey: r.ratingKey, title: r.title });
      }
      sectionTmdbToItem.set(sec.key, map);
    }

    const perCollection: JsonObject[] = [];

    for (const src of DEFAULT_REFRESH_SOURCES) {
      const colSummary = await this.refreshOneCollectionFromJson({
        ctx,
        baseUrl: plexBaseUrl,
        token: plexToken,
        machineIdentifier,
        movieSections,
        sectionTmdbToItem,
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
    movieSections: Array<{ key: string; title: string }>;
    sectionTmdbToItem: Map<string, Map<number, { ratingKey: string; title: string }>>;
    collectionName: string;
    jsonFile: string;
  }): Promise<JsonObject> {
    const {
      ctx,
      baseUrl,
      token,
      machineIdentifier,
      movieSections,
      sectionTmdbToItem,
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

    // Resolve JSON entries to an ordered list of TMDB ids (best-effort).
    const desired: Array<{ title: string; tmdbId: number | null }> = [];
    let skippedUnresolved = 0;
    let tmdbResolved = 0;
    let missingTmdb = 0;

    for (const entry of rawEntries) {
      const rk = pickRatingKey(entry);
      const title = pickTitle(entry);
      if (!rk && !title) {
        skippedUnresolved += 1;
        continue;
      }

      if (rk) {
        const meta = await this.plexServer
          .getMetadataDetails({
            baseUrl,
            token,
            ratingKey: rk,
          })
          .catch(() => null);
        const tmdbId = meta?.tmdbIds?.[0] ?? null;
        desired.push({ title: meta?.title?.trim() || title || rk, tmdbId });
        if (tmdbId) tmdbResolved += 1;
        else missingTmdb += 1;
        continue;
      }

      // No ratingKey (movie may not be in Plex yet). Keep title as a fallback.
      desired.push({ title, tmdbId: null });
      missingTmdb += 1;
    }

    if (!desired.length) {
      await ctx.warn('collection: no usable items from JSON (skipping)', {
        collectionName,
        jsonFile,
        jsonPath,
        totalEntries: rawEntries.length,
        skipped: skippedUnresolved,
      });
      return {
        collectionName,
        source: 'json',
        jsonFile,
        jsonFound: true,
        jsonPath,
        totalEntries: rawEntries.length,
        resolved: 0,
        skipped: skippedUnresolved,
        removed: 0,
        added: 0,
        moved: 0,
      };
    }

    const perLibrary: JsonObject[] = [];

    for (const sec of movieSections) {
      const tmdbMap = sectionTmdbToItem.get(sec.key) ?? new Map();
      const resolvedItems: Array<{ ratingKey: string; title: string }> = [];
      let skippedMissing = 0;
      let resolvedByTitle = 0;

      for (const it of desired) {
        if (it.tmdbId && tmdbMap.has(it.tmdbId)) {
          resolvedItems.push(tmdbMap.get(it.tmdbId)!);
          continue;
        }

        // Fallback: title search in this library (helps when a movie gets added later without tmdb mapping).
        const t = it.title.trim();
        if (!t) {
          skippedMissing += 1;
          continue;
        }
        const found = await this.plexServer
          .findMovieRatingKeyByTitle({
            baseUrl,
            token,
            librarySectionKey: sec.key,
            title: t,
          })
          .catch(() => null);
        if (found) {
          resolvedItems.push({ ratingKey: found.ratingKey, title: found.title });
          resolvedByTitle += 1;
        } else {
          skippedMissing += 1;
        }
      }

      // Deduplicate by ratingKey (keep first title)
      const uniq = new Map<string, string>();
      for (const it of resolvedItems) {
        if (!uniq.has(it.ratingKey)) uniq.set(it.ratingKey, it.title);
      }
      const desiredItems = Array.from(uniq.entries()).map(([ratingKey, title]) => ({
        ratingKey,
        title,
      }));

      if (!desiredItems.length) {
        await ctx.warn('collection: no resolvable items for library (skipping)', {
          collectionName,
          library: sec.title,
          movieSectionKey: sec.key,
          totalEntries: rawEntries.length,
        });
        perLibrary.push({
          library: sec.title,
          movieSectionKey: sec.key,
          resolved: 0,
          skipped: skippedMissing,
          skippedUnresolved,
          skippedReason: 'no_resolvable_items',
        });
        continue;
      }

      const applied = await this.plexCuratedCollections.rebuildMovieCollection({
        ctx,
        baseUrl,
        token,
        machineIdentifier,
        movieSectionKey: sec.key,
        collectionName,
        desiredItems,
        randomizeOrder: true,
      });

      const applySkipped =
        typeof (applied as Record<string, unknown>)['skipped'] === 'number'
          ? ((applied as Record<string, unknown>)['skipped'] as number)
          : 0;
      const skipped = skippedMissing + skippedUnresolved + applySkipped;

      perLibrary.push({
        library: sec.title,
        movieSectionKey: sec.key,
        resolved: desiredItems.length,
        resolvedByTitle,
        skipped,
        ...applied,
      });
    }

    await ctx.info('collection: done', {
      collectionName,
      jsonFile,
      jsonPath,
      totalEntries: rawEntries.length,
      tmdbResolved,
      missingTmdb,
      skippedUnresolved,
      libraries: perLibrary.length,
    });

    return {
      collectionName,
      source: 'json',
      jsonFile,
      jsonFound: true,
      jsonPath,
      totalEntries: rawEntries.length,
      tmdbResolved,
      missingTmdb,
      skippedUnresolved,
      libraries: perLibrary,
    };
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
