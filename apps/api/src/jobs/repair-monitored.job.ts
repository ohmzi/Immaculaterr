import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  PlexServerService,
  type PlexVerifiedEpisodeAvailability,
} from '../plex/plex-server.service';
import {
  SonarrService,
  type SonarrEpisode,
  type SonarrEpisodeFile,
} from '../sonarr/sonarr.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';

const MAX_REPORTED_ITEMS = 100;
const SCAN_SETTLE_INITIAL_MS = 5000;
const SCAN_SETTLE_POLL_MS = 3000;
const SCAN_SETTLE_MAX_MS = 90000;

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

function pickString(obj: Record<string, unknown>, path: string): string | null {
  const v = pick(obj, path);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
}

function requireString(obj: Record<string, unknown>, path: string): string {
  const s = pickString(obj, path);
  if (!s) throw new Error(`Missing required setting: ${path}`);
  return s;
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function episodeKey(season: number, episode: number) {
  return `${season}:${episode}`;
}

function padNum(value: number): string {
  return String(value).padStart(2, '0');
}

function describeEpisode(
  title: string,
  season: number,
  episode: number,
): string {
  return `${title} - S${padNum(season)}E${padNum(episode)}`;
}

function pushCapped(list: string[], item: string) {
  if (list.length >= MAX_REPORTED_ITEMS) return;
  list.push(item);
}

// ---- Path mapping helpers (pure; unit-tested) -----------------------------

export type PathPrefixMapping = { from: string; to: string };

function splitSegments(p: string): string[] {
  let s = p.trim();
  if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
  return s.split('/');
}

function commonSuffixLength(a: string[], b: string[]): number {
  let i = a.length - 1;
  let j = b.length - 1;
  let count = 0;
  while (i >= 0 && j >= 0 && a[i] === b[j]) {
    count += 1;
    i -= 1;
    j -= 1;
  }
  return count;
}

/**
 * Derives Sonarr -> Plex path prefix mappings by matching each Sonarr root
 * folder to the Plex library location that shares the longest trailing path
 * suffix (e.g. `/data/x/Shows` <-> `/media/x/Shows` yields `/data` -> `/media`).
 */
export function derivePathMap(
  sonarrRoots: string[],
  plexLocations: string[],
): PathPrefixMapping[] {
  const seen = new Set<string>();
  const out: PathPrefixMapping[] = [];
  for (const root of sonarrRoots) {
    const rootSegs = splitSegments(root);
    let best: { loc: string; suffix: number } | null = null;
    for (const loc of plexLocations) {
      const suffix = commonSuffixLength(rootSegs, splitSegments(loc));
      if (suffix <= 0) continue;
      if (!best || suffix > best.suffix) best = { loc, suffix };
    }
    if (!best) continue;
    const locSegs = splitSegments(best.loc);
    const fromHead = rootSegs.slice(0, rootSegs.length - best.suffix).join('/');
    const toHead = locSegs.slice(0, locSegs.length - best.suffix).join('/');
    const key = `${fromHead}=>${toHead}`;
    if (fromHead === toHead) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: fromHead, to: toHead });
  }
  return out;
}

function segmentStartsWith(path: string, prefix: string): boolean {
  if (!prefix) return false;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Translates a Sonarr path into the Plex namespace using the longest matching
 * prefix mapping. Returns the original path when no mapping applies.
 */
export function translatePath(
  path: string,
  mappings: PathPrefixMapping[],
): string {
  let match: PathPrefixMapping | null = null;
  for (const m of mappings) {
    if (!segmentStartsWith(path, m.from)) continue;
    if (!match || m.from.length > match.from.length) match = m;
  }
  if (!match) return path;
  return `${match.to}${path.slice(match.from.length)}`;
}

function dirnameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.slice(0, idx) : path;
}

// ---- Job -------------------------------------------------------------------

type ShowLocation = { sectionKey: string; path: string };

type RepairCandidate = {
  seriesTitle: string;
  season: number;
  episode: number;
  episodeId: number;
  episodeFileId: number;
  episode_: SonarrEpisode;
  sonarrPath: string;
  translatedFolder: string;
  sectionKey: string;
  showRatingKeys: string[];
};

@Injectable()
export class RepairMonitoredJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly sonarr: SonarrService,
  ) {}

  // skipcq: JS-R1005 - Coordinates Plex/Sonarr reconcile + repair with explicit branch handling.
  async run(ctx: JobContext): Promise<JobRunResult> {
    const setProgress = (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
      unit?: string;
    }) => {
      const { step, message, current, total, unit } = params;
      void ctx
        .patchSummary({
          phase: 'repairMonitored',
          progress: {
            step,
            message,
            ...(typeof current === 'number' ? { current } : {}),
            ...(typeof total === 'number' ? { total } : {}),
            ...(unit ? { unit } : {}),
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
    };

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);

    const plexBaseUrl =
      pickString(settings, 'plex.baseUrl') ??
      pickString(settings, 'plex.url') ??
      requireString(settings, 'plex.baseUrl');
    const plexToken =
      pickString(secrets, 'plex.token') ??
      pickString(secrets, 'plexToken') ??
      requireString(secrets, 'plex.token');

    const sonarrBaseUrl =
      pickString(settings, 'sonarr.baseUrl') ??
      pickString(settings, 'sonarr.url') ??
      null;
    const sonarrApiKey =
      pickString(secrets, 'sonarr.apiKey') ??
      pickString(secrets, 'sonarrApiKey') ??
      null;
    const sonarrEnabledSetting = pickBool(settings, 'sonarr.enabled');
    const sonarrIntegrationEnabled =
      (sonarrEnabledSetting ?? Boolean(sonarrApiKey)) === true;
    const sonarrConfigured =
      sonarrIntegrationEnabled && Boolean(sonarrBaseUrl && sonarrApiKey);

    if (!sonarrConfigured) {
      throw new Error(
        'Repair Monitored requires Sonarr to be configured (baseUrl + apiKey).',
      );
    }
    const sonarrUrl = sonarrBaseUrl as string;
    const sonarrKey = sonarrApiKey as string;

    // Counters
    let totalSeries = 0;
    let seriesProcessed = 0;
    let episodesChecked = 0;
    let confirmedInPlex = 0;
    let unmonitored = 0;
    let inPlexUnverified = 0;
    let showsNotInPlex = 0;
    let missingNoFile = 0;
    let scannedFolders = 0;
    let recoveredByScan = 0;
    let deletedFiles = 0;
    let blocklisted = 0;
    let blocklistUnavailable = 0;
    let searchQueued = 0;
    let uncoveredPaths = 0;
    let availabilityFailures = 0;
    let actionFailures = 0;

    const unmonitoredSamples: string[] = [];
    const wouldRepairSamples: string[] = [];
    const deletedSamples: string[] = [];
    const blocklistUnavailableSamples: string[] = [];
    const uncoveredSamples: string[] = [];
    const recoveredSamples: string[] = [];
    const stillMissingSamples: string[] = [];
    const showsNotInPlexSamples: string[] = [];

    await ctx.info('repairMonitored: start', {
      dryRun: ctx.dryRun,
      plexBaseUrl,
      sonarrBaseUrl,
    });
    setProgress({ step: 'plex_discovery', message: 'Discovering Plex…' });

    // --- Plex library discovery -------------------------------------------
    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const tvSections = sections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'show',
    );

    const sectionLocations = await this.plexServer.getSectionLocations({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const showLocations: ShowLocation[] = [];
    for (const [sectionKey, info] of sectionLocations.entries()) {
      if ((info.type ?? '').toLowerCase() !== 'show') continue;
      for (const path of info.locations) {
        showLocations.push({ sectionKey, path });
      }
    }

    // --- Path map (auto-derived + optional settings override) -------------
    const rootFolders = await this.sonarr.listRootFolders({
      baseUrl: sonarrUrl,
      apiKey: sonarrKey,
    });
    const derived = derivePathMap(
      rootFolders.map((r) => r.path),
      showLocations.map((l) => l.path),
    );
    const overrides = readPathOverrides(settings);
    const pathMap = [...overrides, ...derived];
    await ctx.info('repairMonitored: path map', {
      derived,
      overrides,
      sonarrRoots: rootFolders.map((r) => r.path),
      plexLocations: showLocations.map((l) => l.path),
    });

    // --- Plex tvdb -> ratingKeys map --------------------------------------
    setProgress({
      step: 'plex_tvdb_index',
      message: 'Indexing Plex TV shows…',
    });
    const tvdbRatingKeys = new Map<number, string[]>();
    for (const sec of tvSections) {
      const map = await this.plexServer.getTvdbShowRatingKeysMapForSectionKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey: sec.key,
        sectionTitle: sec.title,
      });
      for (const [tvdbId, ratingKeys] of map.entries()) {
        const prev = tvdbRatingKeys.get(tvdbId) ?? [];
        for (const rk of ratingKeys) if (!prev.includes(rk)) prev.push(rk);
        tvdbRatingKeys.set(tvdbId, prev);
      }
    }

    // Availability cache (pass A). Value null => fetch failed.
    const availabilityCache = new Map<
      string,
      PlexVerifiedEpisodeAvailability | null
    >();
    const getAvailability = async (ratingKey: string) => {
      const cached = availabilityCache.get(ratingKey);
      if (cached !== undefined) return cached;
      try {
        const result =
          await this.plexServer.getVerifiedEpisodeAvailabilityForShowRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            showRatingKey: ratingKey,
          });
        availabilityCache.set(ratingKey, result);
        return result;
      } catch (error) {
        availabilityCache.set(ratingKey, null);
        await ctx.warn('plex: availability fetch failed', {
          ratingKey,
          error: (error as Error)?.message ?? String(error),
        });
        return null;
      }
    };

    // --- Pass A: classify -------------------------------------------------
    const monitoredSeries = await this.sonarr.listMonitoredSeries({
      baseUrl: sonarrUrl,
      apiKey: sonarrKey,
    });
    totalSeries = monitoredSeries.length;
    setProgress({
      step: 'classify',
      message: 'Scanning Sonarr series…',
      current: 0,
      total: totalSeries,
      unit: 'series',
    });

    const repairCandidates: RepairCandidate[] = [];
    const scanTargets = new Map<
      string,
      { sectionKey: string; folder: string }
    >();

    for (const series of monitoredSeries) {
      seriesProcessed += 1;
      const title =
        typeof series.title === 'string' ? series.title : `series#${series.id}`;
      const tvdbId = toInt(series.tvdbId);

      const showRatingKeys = tvdbId ? (tvdbRatingKeys.get(tvdbId) ?? []) : [];
      const showFoundInPlex = showRatingKeys.length > 0;

      // Build union availability for the show.
      const verified = new Set<string>();
      const metadata = new Set<string>();
      let availabilityOk = showFoundInPlex;
      if (showFoundInPlex) {
        for (const rk of showRatingKeys) {
          const availability = await getAvailability(rk);
          if (!availability) {
            availabilityOk = false;
            continue;
          }
          for (const k of availability.verifiedEpisodes) verified.add(k);
          for (const k of availability.metadataEpisodes) metadata.add(k);
        }
      }
      if (showFoundInPlex && !availabilityOk) availabilityFailures += 1;
      if (!showFoundInPlex) {
        showsNotInPlex += 1;
        pushCapped(showsNotInPlexSamples, title);
      }

      const episodes = await this.sonarr.getEpisodesBySeries({
        baseUrl: sonarrUrl,
        apiKey: sonarrKey,
        seriesId: series.id,
      });
      const files = await this.sonarr.getEpisodeFiles({
        baseUrl: sonarrUrl,
        apiKey: sonarrKey,
        seriesId: series.id,
      });
      const fileById = new Map<number, SonarrEpisodeFile>();
      for (const f of files) fileById.set(f.id, f);

      for (const ep of episodes) {
        const season = toInt(ep.seasonNumber);
        const epNum = toInt(ep.episodeNumber);
        if (!season || !epNum) continue;
        episodesChecked += 1;
        const key = episodeKey(season, epNum);
        const label = describeEpisode(title, season, epNum);

        // Show not in Plex, or availability unknown -> never delete; report only.
        if (!showFoundInPlex || !availabilityOk) continue;

        if (verified.has(key)) {
          confirmedInPlex += 1;
          if (ep.monitored) {
            if (ctx.dryRun) {
              unmonitored += 1;
              pushCapped(unmonitoredSamples, label);
            } else {
              try {
                await this.sonarr.setEpisodeMonitored({
                  baseUrl: sonarrUrl,
                  apiKey: sonarrKey,
                  episode: ep,
                  monitored: false,
                });
                unmonitored += 1;
                pushCapped(unmonitoredSamples, label);
              } catch (error) {
                actionFailures += 1;
                await ctx.warn('sonarr: unmonitor failed', {
                  label,
                  error: (error as Error)?.message ?? String(error),
                });
              }
            }
          }
          continue;
        }

        if (metadata.has(key)) {
          // In Plex metadata but not verified playable — leave alone.
          inPlexUnverified += 1;
          continue;
        }

        // Truly absent from Plex.
        const fileId = toInt(ep.episodeFileId);
        const file =
          ep.hasFile === true && fileId ? fileById.get(fileId) : undefined;
        if (!file) {
          missingNoFile += 1;
          continue;
        }

        const translated = translatePath(file.path, pathMap);
        const cover = showLocations.find((loc) =>
          segmentStartsWith(translated, loc.path),
        );
        if (!cover) {
          uncoveredPaths += 1;
          pushCapped(uncoveredSamples, `${label}  (${file.path})`);
          continue;
        }

        const folder = dirnameOf(translated);
        repairCandidates.push({
          seriesTitle: title,
          season,
          episode: epNum,
          episodeId: ep.id,
          episodeFileId: file.id,
          episode_: ep,
          sonarrPath: file.path,
          translatedFolder: folder,
          sectionKey: cover.sectionKey,
          showRatingKeys,
        });
        scanTargets.set(`${cover.sectionKey}:${folder}`, {
          sectionKey: cover.sectionKey,
          folder,
        });
      }

      if (seriesProcessed % 10 === 0 || seriesProcessed === totalSeries) {
        setProgress({
          step: 'classify',
          message: 'Scanning Sonarr series…',
          current: seriesProcessed,
          total: totalSeries,
          unit: 'series',
        });
      }
    }

    // --- Dry run: project, then stop --------------------------------------
    if (ctx.dryRun) {
      for (const c of repairCandidates) {
        pushCapped(
          wouldRepairSamples,
          describeEpisode(c.seriesTitle, c.season, c.episode),
        );
      }
      const summary = buildRawSummary({
        dryRun: true,
        totalSeries,
        seriesProcessed,
        episodesChecked,
        confirmedInPlex,
        unmonitored,
        inPlexUnverified,
        showsNotInPlex,
        missingNoFile,
        scannedFolders: scanTargets.size,
        recoveredByScan,
        deletedFiles: 0,
        blocklisted: 0,
        blocklistUnavailable: 0,
        searchQueued: 0,
        uncoveredPaths,
        repairCandidates: repairCandidates.length,
        availabilityFailures,
        actionFailures,
        samples: {
          unmonitoredSamples,
          wouldRepairSamples,
          deletedSamples,
          blocklistUnavailableSamples,
          uncoveredSamples,
          recoveredSamples,
          stillMissingSamples,
          showsNotInPlexSamples,
        },
      });
      await ctx.patchSummary({
        progress: {
          step: 'done',
          message: 'Dry-run complete.',
          updatedAt: new Date().toISOString(),
        },
      });
      await ctx.info('repairMonitored: dry-run done', summary);
      return {
        summary: buildReport({ ctx, raw: summary }) as unknown as JsonObject,
      };
    }

    // --- Live: trigger targeted scans -------------------------------------
    if (scanTargets.size > 0) {
      setProgress({
        step: 'scan',
        message: `Scanning ${scanTargets.size} Plex folder(s)…`,
      });
      for (const { sectionKey, folder } of scanTargets.values()) {
        try {
          await this.plexServer.refreshLibraryPath({
            baseUrl: plexBaseUrl,
            token: plexToken,
            sectionKey,
            path: folder,
          });
          scannedFolders += 1;
        } catch (error) {
          await ctx.warn('plex: refresh path failed', {
            sectionKey,
            folder,
            error: (error as Error)?.message ?? String(error),
          });
        }
      }
      await this.waitForScansToSettle(ctx, plexBaseUrl, plexToken);
    }

    // --- Pass B: re-verify + repair ---------------------------------------
    const freshAvailability = new Map<
      string,
      PlexVerifiedEpisodeAvailability | null
    >();
    const getFresh = async (ratingKey: string) => {
      const cached = freshAvailability.get(ratingKey);
      if (cached !== undefined) return cached;
      try {
        const result =
          await this.plexServer.getVerifiedEpisodeAvailabilityForShowRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            showRatingKey: ratingKey,
          });
        freshAvailability.set(ratingKey, result);
        return result;
      } catch {
        freshAvailability.set(ratingKey, null);
        return null;
      }
    };

    let repairProcessed = 0;
    setProgress({
      step: 'repair',
      message: 'Repairing unfit files…',
      current: 0,
      total: repairCandidates.length,
      unit: 'episodes',
    });
    for (const c of repairCandidates) {
      repairProcessed += 1;
      const label = describeEpisode(c.seriesTitle, c.season, c.episode);
      const key = episodeKey(c.season, c.episode);

      // Re-verify against a fresh scan.
      const verified = new Set<string>();
      const metadata = new Set<string>();
      let ok = true;
      for (const rk of c.showRatingKeys) {
        const availability = await getFresh(rk);
        if (!availability) {
          ok = false;
          continue;
        }
        for (const k of availability.verifiedEpisodes) verified.add(k);
        for (const k of availability.metadataEpisodes) metadata.add(k);
      }

      if (!ok) {
        // Couldn't re-verify — do not delete. Report and move on.
        availabilityFailures += 1;
        pushCapped(stillMissingSamples, `${label} (re-verify failed)`);
        continue;
      }

      if (metadata.has(key)) {
        // The scan picked it up: the file was fine, just unscanned.
        recoveredByScan += 1;
        pushCapped(recoveredSamples, label);
        if (verified.has(key) && c.episode_.monitored) {
          try {
            await this.sonarr.setEpisodeMonitored({
              baseUrl: sonarrUrl,
              apiKey: sonarrKey,
              episode: c.episode_,
              monitored: false,
            });
            unmonitored += 1;
            pushCapped(unmonitoredSamples, label);
          } catch {
            actionFailures += 1;
          }
        }
        continue;
      }

      // Still absent after scan -> the file is unfit. Delete + blocklist + search.
      try {
        await this.sonarr.deleteEpisodeFile({
          baseUrl: sonarrUrl,
          apiKey: sonarrKey,
          episodeFileId: c.episodeFileId,
        });
        deletedFiles += 1;
        pushCapped(deletedSamples, `${label}  (${c.sonarrPath})`);
      } catch (error) {
        actionFailures += 1;
        await ctx.warn('sonarr: delete episode file failed', {
          label,
          episodeFileId: c.episodeFileId,
          error: (error as Error)?.message ?? String(error),
        });
        continue;
      }

      // Blocklist the exact grabbed release (best-effort).
      try {
        const history = await this.sonarr.listEpisodeHistory({
          baseUrl: sonarrUrl,
          apiKey: sonarrKey,
          episodeId: c.episodeId,
        });
        const grabbed = history
          .filter((h) => (h.eventType ?? '').toLowerCase() === 'grabbed')
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
        if (grabbed.length > 0) {
          await this.sonarr.markHistoryFailed({
            baseUrl: sonarrUrl,
            apiKey: sonarrKey,
            historyId: grabbed[0].id,
          });
          blocklisted += 1;
        } else {
          blocklistUnavailable += 1;
          pushCapped(blocklistUnavailableSamples, label);
        }
      } catch (error) {
        blocklistUnavailable += 1;
        pushCapped(blocklistUnavailableSamples, label);
        await ctx.warn('sonarr: blocklist failed', {
          label,
          error: (error as Error)?.message ?? String(error),
        });
      }

      // Trigger a fresh grab.
      try {
        const ok2 = await this.sonarr.searchEpisodes({
          baseUrl: sonarrUrl,
          apiKey: sonarrKey,
          episodeIds: [c.episodeId],
        });
        if (ok2) searchQueued += 1;
      } catch (error) {
        await ctx.warn('sonarr: episode search failed', {
          label,
          error: (error as Error)?.message ?? String(error),
        });
      }

      if (
        repairProcessed % 5 === 0 ||
        repairProcessed === repairCandidates.length
      ) {
        setProgress({
          step: 'repair',
          message: 'Repairing unfit files…',
          current: repairProcessed,
          total: repairCandidates.length,
          unit: 'episodes',
        });
      }
    }

    const summary = buildRawSummary({
      dryRun: false,
      totalSeries,
      seriesProcessed,
      episodesChecked,
      confirmedInPlex,
      unmonitored,
      inPlexUnverified,
      showsNotInPlex,
      missingNoFile,
      scannedFolders,
      recoveredByScan,
      deletedFiles,
      blocklisted,
      blocklistUnavailable,
      searchQueued,
      uncoveredPaths,
      repairCandidates: repairCandidates.length,
      availabilityFailures,
      actionFailures,
      samples: {
        unmonitoredSamples,
        wouldRepairSamples,
        deletedSamples,
        blocklistUnavailableSamples,
        uncoveredSamples,
        recoveredSamples,
        stillMissingSamples,
        showsNotInPlexSamples,
      },
    });
    await ctx.patchSummary({
      progress: {
        step: 'done',
        message: 'Completed.',
        updatedAt: new Date().toISOString(),
      },
    });
    await ctx.info('repairMonitored: done', summary);
    return {
      summary: buildReport({ ctx, raw: summary }) as unknown as JsonObject,
    };
  }

  private async waitForScansToSettle(
    ctx: JobContext,
    plexBaseUrl: string,
    plexToken: string,
  ): Promise<void> {
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    await sleep(SCAN_SETTLE_INITIAL_MS);
    const start = Date.now();
    while (Date.now() - start < SCAN_SETTLE_MAX_MS) {
      let scanning = false;
      try {
        const activities = await this.plexServer.listActivities({
          baseUrl: plexBaseUrl,
          token: plexToken,
        });
        scanning = activities.some((a) => {
          const type = (a.type ?? '').toLowerCase();
          const title = (a.title ?? '').toLowerCase();
          return type.includes('library.update') || title.includes('scan');
        });
      } catch {
        // If we can't read activities, stop waiting and proceed.
        return;
      }
      if (!scanning) return;
      await sleep(SCAN_SETTLE_POLL_MS);
    }
    await ctx.info('plex: scan settle timed out; proceeding');
  }
}

function readPathOverrides(
  settings: Record<string, unknown>,
): PathPrefixMapping[] {
  const raw = pick(settings, 'sonarr.plexPathMappings');
  if (!Array.isArray(raw)) return [];
  const out: PathPrefixMapping[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const from = typeof entry['from'] === 'string' ? entry['from'].trim() : '';
    const to = typeof entry['to'] === 'string' ? entry['to'].trim() : '';
    if (from && to) out.push({ from, to });
  }
  return out;
}

type RawSummaryInput = {
  dryRun: boolean;
  totalSeries: number;
  seriesProcessed: number;
  episodesChecked: number;
  confirmedInPlex: number;
  unmonitored: number;
  inPlexUnverified: number;
  showsNotInPlex: number;
  missingNoFile: number;
  scannedFolders: number;
  recoveredByScan: number;
  deletedFiles: number;
  blocklisted: number;
  blocklistUnavailable: number;
  searchQueued: number;
  uncoveredPaths: number;
  repairCandidates: number;
  availabilityFailures: number;
  actionFailures: number;
  samples: {
    unmonitoredSamples: string[];
    wouldRepairSamples: string[];
    deletedSamples: string[];
    blocklistUnavailableSamples: string[];
    uncoveredSamples: string[];
    recoveredSamples: string[];
    stillMissingSamples: string[];
    showsNotInPlexSamples: string[];
  };
};

function buildRawSummary(input: RawSummaryInput): JsonObject {
  return {
    phase: 'repairMonitored',
    dryRun: input.dryRun,
    totalSeries: input.totalSeries,
    seriesProcessed: input.seriesProcessed,
    episodesChecked: input.episodesChecked,
    confirmedInPlex: input.confirmedInPlex,
    unmonitored: input.unmonitored,
    inPlexUnverified: input.inPlexUnverified,
    showsNotInPlex: input.showsNotInPlex,
    missingNoFile: input.missingNoFile,
    scannedFolders: input.scannedFolders,
    recoveredByScan: input.recoveredByScan,
    deletedFiles: input.deletedFiles,
    blocklisted: input.blocklisted,
    blocklistUnavailable: input.blocklistUnavailable,
    searchQueued: input.searchQueued,
    uncoveredPaths: input.uncoveredPaths,
    repairCandidates: input.repairCandidates,
    availabilityFailures: input.availabilityFailures,
    actionFailures: input.actionFailures,
    ...input.samples,
  } as unknown as JsonObject;
}

function buildReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;
  const n = (k: string): number => {
    const v = raw[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };

  const issues = [
    ...(n('uncoveredPaths')
      ? [
          issue(
            'warn',
            `${n('uncoveredPaths')} episode file(s) sit outside any Plex library location (reported, no action).`,
          ),
        ]
      : []),
    ...(n('blocklistUnavailable')
      ? [
          issue(
            'warn',
            `${n('blocklistUnavailable')} file(s) were deleted but could not be blocklisted (no grab history — e.g. wrong-show import).`,
          ),
        ]
      : []),
    ...(n('showsNotInPlex')
      ? [
          issue(
            'warn',
            `${n('showsNotInPlex')} monitored series were not found in Plex at all (skipped for safety).`,
          ),
        ]
      : []),
    ...(n('availabilityFailures')
      ? [
          issue(
            'warn',
            `${n('availabilityFailures')} series could not be verified against Plex (skipped for safety).`,
          ),
        ]
      : []),
    ...(n('actionFailures')
      ? [issue('warn', `${n('actionFailures')} Sonarr action(s) failed.`)]
      : []),
  ];

  const repairLabel = ctx.dryRun ? 'Would delete + blocklist' : 'Deleted files';
  const repairValue = ctx.dryRun ? n('repairCandidates') : n('deletedFiles');

  const sampleFact = (label: string, key: string, unit: string) => ({
    label,
    value: {
      count: Array.isArray(raw[key]) ? (raw[key] as unknown[]).length : 0,
      unit,
      items: Array.isArray(raw[key]) ? (raw[key] as string[]) : [],
    },
  });

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline: ctx.dryRun
      ? 'Repair Monitored dry-run complete.'
      : 'Repair Monitored run complete.',
    sections: [
      {
        id: 'summary',
        title: 'Sonarr ↔ Plex',
        rows: [
          metricRow({
            label: 'Monitored series',
            end: n('totalSeries'),
            unit: 'series',
          }),
          metricRow({
            label: 'Episodes checked',
            end: n('episodesChecked'),
            unit: 'episodes',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would unmonitor' : 'Unmonitored',
            end: n('unmonitored'),
            unit: 'episodes',
          }),
          metricRow({
            label: repairLabel,
            end: repairValue,
            unit: 'episodes',
          }),
        ],
      },
    ],
    tasks: [
      {
        id: 'confirm',
        title: 'Confirm in-Plex episodes',
        status: 'success',
        rows: [
          metricRow({
            label: 'Confirmed in Plex',
            end: n('confirmedInPlex'),
            unit: 'episodes',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would unmonitor' : 'Unmonitored',
            end: n('unmonitored'),
            unit: 'episodes',
          }),
          metricRow({
            label: 'In Plex but unverified (left as-is)',
            end: n('inPlexUnverified'),
            unit: 'episodes',
          }),
        ],
        facts: [sampleFact('Unmonitored', 'unmonitoredSamples', 'episodes')],
      },
      {
        id: 'repair',
        title: 'Repair unfit files',
        status: 'success',
        rows: [
          metricRow({
            label: 'Repair candidates (missing from Plex, file covered)',
            end: n('repairCandidates'),
            unit: 'episodes',
          }),
          metricRow({
            label: 'Folders scanned',
            end: n('scannedFolders'),
            unit: 'folders',
          }),
          metricRow({
            label: 'Recovered by scan (kept)',
            end: n('recoveredByScan'),
            unit: 'episodes',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would delete' : 'Deleted files',
            end: repairValue,
            unit: 'episodes',
          }),
          metricRow({
            label: 'Blocklisted releases',
            end: n('blocklisted'),
            unit: 'releases',
          }),
          metricRow({
            label: 'Blocklist unavailable',
            end: n('blocklistUnavailable'),
            unit: 'episodes',
          }),
          metricRow({
            label: ctx.dryRun ? 'Would re-search' : 'Searches queued',
            end: n('searchQueued'),
            unit: 'episodes',
          }),
          metricRow({
            label: 'Uncovered paths (reported)',
            end: n('uncoveredPaths'),
            unit: 'episodes',
          }),
        ],
        facts: [
          ctx.dryRun
            ? sampleFact(
                'Would delete + blocklist',
                'wouldRepairSamples',
                'episodes',
              )
            : sampleFact('Deleted', 'deletedSamples', 'episodes'),
          sampleFact('Recovered by scan', 'recoveredSamples', 'episodes'),
          sampleFact(
            'Blocklist unavailable',
            'blocklistUnavailableSamples',
            'episodes',
          ),
          sampleFact('Uncovered paths', 'uncoveredSamples', 'episodes'),
          sampleFact('Shows not in Plex', 'showsNotInPlexSamples', 'series'),
        ],
        issues: issues.length ? issues : undefined,
      },
    ],
    issues,
    raw,
  };
}
