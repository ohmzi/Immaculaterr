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
    let skippedUnresolved = 0;
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
          skippedUnresolved += 1;
        }
        continue;
      }

      skippedUnresolved += 1;
    }

    if (!resolved.length) {
      await ctx.warn('collection: no resolvable items from JSON (skipping)', {
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

    // Deduplicate by ratingKey (keep first title)
    const uniq = new Map<string, string>();
    for (const it of resolved) {
      if (!uniq.has(it.ratingKey)) uniq.set(it.ratingKey, it.title);
    }

    const desiredItems = Array.from(uniq.entries()).map(([ratingKey, title]) => ({
      ratingKey,
      title,
    }));

    const applied = await this.plexCuratedCollections.rebuildMovieCollection({
      ctx,
      baseUrl,
      token,
      machineIdentifier,
      movieSectionKey,
      collectionName,
      desiredItems,
      randomizeOrder: true,
    });

    const applySkipped =
      typeof (applied as Record<string, unknown>)['skipped'] === 'number'
        ? ((applied as Record<string, unknown>)['skipped'] as number)
        : 0;
    const skipped = skippedUnresolved + applySkipped;

    await ctx.info('collection: done', {
      collectionName,
      jsonFile,
      ...applied,
      skippedUnresolved,
      skipped,
    });

    return {
      collectionName,
      source: 'json',
      jsonFile,
      jsonFound: true,
      jsonPath,
      totalEntries: rawEntries.length,
      resolved: desiredItems.length,
      ...applied,
      skipped,
      skippedUnresolved,
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
