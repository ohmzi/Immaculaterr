import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ArrInstanceService } from '../arr-instances/arr-instance.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';
import {
  derivePathMap,
  translatePath,
  type PathPrefixMapping,
} from '../jobs/repair-monitored.job';
import { normalizeCuttingRoomRules } from './cutting-room-scoring';

export type PruneProgress = (params: {
  step: string;
  message: string;
  current?: number;
  total?: number;
}) => void;

export type PruneLoggers = {
  info: (message: string, context?: Record<string, unknown>) => Promise<void>;
  warn: (message: string, context?: Record<string, unknown>) => Promise<void>;
};

export type PruneSummary = {
  dryRun: boolean;
  planned: number;
  pruned: number;
  skippedStale: number;
  skippedPlexOnly: number;
  failed: number;
  bytesFreed: number;
  wavesRun: number;
  stopped: boolean;
  wouldDelete: Array<{ title: string; sizeBytes: number; action: string }>;
};

type Candidate = {
  id: string;
  mediaType: string;
  title: string;
  year: number | null;
  sizeBytes: bigint;
  plexRatingKey: string | null;
  librarySectionKey: string | null;
  tmdbId: number | null;
  tvdbId: number | null;
  arrInstanceId: string | null;
  arrId: number | null;
  rootFolderPath: string | null;
  path: string | null;
  watchStatus: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickString(obj: Record<string, unknown>, path: string): string | null {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return null;
    cur = cur[part];
  }
  return typeof cur === 'string' && cur.trim() ? cur.trim() : null;
}

@Injectable()
export class CuttingRoomPruneService {
  private readonly logger = new Logger(CuttingRoomPruneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly arrInstances: ArrInstanceService,
    private readonly plexServer: PlexServerService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
  ) {}

  async runPrune(params: {
    userId: string;
    snapshotId: string;
    runId: string;
    dryRun: boolean;
    waveSize: number;
    removeEntry: boolean;
    addImportExclusion: boolean;
    progress: PruneProgress;
    log: PruneLoggers;
  }): Promise<PruneSummary> {
    const {
      userId,
      snapshotId,
      runId,
      dryRun,
      removeEntry,
      addImportExclusion,
      progress,
      log,
    } = params;
    const waveSize = Math.max(1, Math.min(200, params.waveSize));

    const snapshot = await this.prisma.cuttingRoomSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot || snapshot.userId !== userId) {
      throw new Error(`Cutting Room snapshot not found: ${snapshotId}`);
    }
    if (!['READY', 'PARTIAL', 'PRUNING'].includes(snapshot.status)) {
      throw new Error(
        `Cutting Room snapshot is not in a prunable state (status=${snapshot.status})`,
      );
    }
    const rules = normalizeCuttingRoomRules(snapshot.rulesJson);
    const mediaType = snapshot.mediaType === 'show' ? 'show' : 'movie';

    const candidates: Candidate[] =
      await this.prisma.cuttingRoomCandidate.findMany({
        where: { snapshotId, selected: true, pruneStatus: 'pending' },
        orderBy: [{ tier: 'asc' }, { score: 'desc' }],
        select: {
          id: true,
          mediaType: true,
          title: true,
          year: true,
          sizeBytes: true,
          plexRatingKey: true,
          librarySectionKey: true,
          tmdbId: true,
          tvdbId: true,
          arrInstanceId: true,
          arrId: true,
          rootFolderPath: true,
          path: true,
          watchStatus: true,
        },
      });

    if (candidates.length === 0) {
      return {
        dryRun,
        planned: 0,
        pruned: 0,
        skippedStale: 0,
        skippedPlexOnly: 0,
        failed: 0,
        bytesFreed: 0,
        wavesRun: 0,
        stopped: false,
        wouldDelete: [],
      };
    }

    const totalBytes = candidates.reduce(
      (sum, c) => sum + Number(c.sizeBytes),
      0,
    );
    if (candidates.length > rules.maxItemsPerRun) {
      throw new Error(
        `Selection exceeds the per-run cap of ${rules.maxItemsPerRun} items — split into smaller runs.`,
      );
    }
    if (totalBytes > rules.maxBytesPerRun) {
      throw new Error(
        `Selection exceeds the per-run cap of ${(rules.maxBytesPerRun / 1e12).toFixed(1)} TB — split into smaller runs.`,
      );
    }

    if (!dryRun) {
      await this.prisma.cuttingRoomSnapshot.update({
        where: { id: snapshotId },
        data: { status: 'PRUNING', pruneRunId: runId, stopRequested: false },
      });
    }

    // ---- Resolve arr instances involved -----------------------------------
    const arrType = mediaType === 'movie' ? 'radarr' : 'sonarr';
    const instanceIds = Array.from(
      new Set(
        candidates
          .map((c) => c.arrInstanceId)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const instances = new Map<string, { baseUrl: string; apiKey: string }>();
    for (const id of instanceIds) {
      try {
        const inst = await this.arrInstances.resolveInstance(
          userId,
          arrType,
          id,
          { requireConfigured: false },
        );
        if (inst?.baseUrl && inst?.apiKey) {
          instances.set(id, { baseUrl: inst.baseUrl, apiKey: inst.apiKey });
        }
      } catch (err) {
        await log.warn(
          `cutting room prune: cannot resolve ${arrType} instance ${id}: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }

    // ---- Freshness pass ----------------------------------------------------
    progress({ step: 'freshness', message: 'Re-checking candidates…' });

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const plexBaseUrl =
      pickString(settings, 'plex.baseUrl') ?? pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') ?? pickString(secrets, 'plexToken');

    const freshPlexByKey = new Map<
      string,
      { viewCount: number; lastViewedAt: number | null }
    >();
    const sectionKeys = Array.from(
      new Set(
        candidates
          .map((c) => c.librarySectionKey)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    if (plexBaseUrl && plexToken) {
      for (const sectionKey of sectionKeys) {
        try {
          const items = await this.plexServer.listSectionItemsForCuttingRoom({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: sectionKey,
            mediaType,
          });
          for (const item of items) {
            freshPlexByKey.set(item.ratingKey, {
              viewCount: item.viewCount + (item.viewedLeafCount ?? 0),
              lastViewedAt: item.lastViewedAt,
            });
          }
        } catch (err) {
          await log.warn(
            `cutting room prune: fresh Plex scan failed for section ${sectionKey}: ${(err as Error)?.message ?? String(err)}`,
          );
        }
      }
    }

    type FreshArrMovie = { movieFileId: number; hasFile: boolean };
    const freshMovieById = new Map<string, FreshArrMovie>();
    const freshSeriesIds = new Set<string>();
    for (const [instanceId, creds] of instances) {
      try {
        if (mediaType === 'movie') {
          const movies = await this.radarr.listMovies(creds);
          for (const movie of movies) {
            freshMovieById.set(`${instanceId}:${movie.id}`, {
              movieFileId:
                typeof movie.movieFileId === 'number' ? movie.movieFileId : 0,
              hasFile: Boolean(movie.hasFile),
            });
          }
        } else {
          const series = await this.sonarr.listSeries(creds);
          for (const show of series) {
            freshSeriesIds.add(`${instanceId}:${show.id}`);
          }
        }
      } catch (err) {
        await log.warn(
          `cutting room prune: fresh ${arrType} listing failed for ${instanceId}: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }

    const snapshotCreatedMs = snapshot.createdAt.getTime();
    const actionable: Candidate[] = [];
    let skippedStale = 0;
    let skippedPlexOnly = 0;
    for (const candidate of candidates) {
      const fresh = candidate.plexRatingKey
        ? freshPlexByKey.get(candidate.plexRatingKey)
        : undefined;
      // Removed from Plex since analysis, or watched since analysis.
      if (candidate.plexRatingKey && plexBaseUrl && plexToken && !fresh) {
        skippedStale += 1;
        if (!dryRun) {
          await this.markCandidate(
            candidate.id,
            'skipped_stale',
            'gone from Plex',
          );
        }
        continue;
      }
      if (
        fresh &&
        candidate.watchStatus === 'never' &&
        (fresh.viewCount > 0 ||
          (fresh.lastViewedAt ?? 0) * 1000 > snapshotCreatedMs)
      ) {
        skippedStale += 1;
        if (!dryRun) {
          await this.markCandidate(
            candidate.id,
            'skipped_stale',
            'watched since analysis',
          );
        }
        continue;
      }
      const isArrTracked = Boolean(candidate.arrInstanceId && candidate.arrId);
      if (!isArrTracked && !rules.allowPlexOnlyDeletes) {
        skippedPlexOnly += 1;
        if (!dryRun) {
          await this.markCandidate(
            candidate.id,
            'skipped_plex_only',
            'not tracked by Radarr/Sonarr and Plex-only deletes are disabled',
          );
        }
        continue;
      }
      actionable.push(candidate);
    }

    // ---- Tag ensure --------------------------------------------------------
    progress({ step: 'tagging', message: 'Ensuring prune tag exists…' });
    const tagIdByInstance = new Map<string, number>();
    for (const [instanceId, creds] of instances) {
      try {
        const client = mediaType === 'movie' ? this.radarr : this.sonarr;
        const tags = await client.listTags(creds);
        const existing = tags.find(
          (t) => t.label.toLowerCase() === rules.pruneTagLabel,
        );
        if (existing) {
          tagIdByInstance.set(instanceId, existing.id);
        } else if (!dryRun) {
          const created = await client.createTag({
            ...creds,
            label: rules.pruneTagLabel,
          });
          tagIdByInstance.set(instanceId, created.id);
        }
      } catch (err) {
        await log.warn(
          `cutting room prune: tag ensure failed for ${instanceId}: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }

    // ---- Path map for targeted Plex refresh --------------------------------
    let pathMappings: PathPrefixMapping[] = [];
    if (plexBaseUrl && plexToken && !dryRun) {
      try {
        const locations = await this.plexServer.getSectionLocations({
          baseUrl: plexBaseUrl,
          token: plexToken,
        });
        const plexPaths: string[] = [];
        for (const info of locations.values()) {
          plexPaths.push(...info.locations);
        }
        const arrRoots = Array.from(
          new Set(
            candidates
              .map((c) => c.rootFolderPath)
              .filter((v): v is string => Boolean(v)),
          ),
        );
        pathMappings = derivePathMap(arrRoots, plexPaths);
      } catch {
        // Refresh becomes whole-section instead of targeted.
      }
    }

    // ---- Waves --------------------------------------------------------------
    let pruned = 0;
    let failed = 0;
    let bytesFreed = 0;
    let wavesRun = 0;
    let stopped = false;
    const wouldDelete: PruneSummary['wouldDelete'] = [];

    for (let offset = 0; offset < actionable.length; offset += waveSize) {
      // Stop between waves when asked (UI Stop button) or queue paused.
      const freshSnapshot = await this.prisma.cuttingRoomSnapshot.findUnique({
        where: { id: snapshotId },
        select: { stopRequested: true },
      });
      if (freshSnapshot?.stopRequested) {
        stopped = true;
        break;
      }

      const wave = actionable.slice(offset, offset + waveSize);
      wavesRun += 1;
      progress({
        step: 'pruning',
        message: `${dryRun ? 'Rehearsing' : 'Pruning'} wave ${wavesRun} (${Math.min(offset + waveSize, actionable.length)}/${actionable.length})…`,
        current: Math.min(offset + waveSize, actionable.length),
        total: actionable.length,
      });

      let waveFailures = 0;
      const refreshTargets = new Set<string>();

      // Group the wave per instance for bulk editor calls.
      const byInstance = new Map<string, Candidate[]>();
      const plexOnly: Candidate[] = [];
      for (const candidate of wave) {
        if (candidate.arrInstanceId && candidate.arrId) {
          const list = byInstance.get(candidate.arrInstanceId) ?? [];
          list.push(candidate);
          byInstance.set(candidate.arrInstanceId, list);
        } else {
          plexOnly.push(candidate);
        }
      }

      for (const [instanceId, list] of byInstance) {
        const creds = instances.get(instanceId);
        if (!creds) {
          for (const candidate of list) {
            failed += 1;
            waveFailures += 1;
            if (!dryRun) {
              await this.markCandidate(
                candidate.id,
                'failed',
                `arr instance ${instanceId} is not configured`,
              );
            }
          }
          continue;
        }
        const tagId = tagIdByInstance.get(instanceId);
        const arrIds = list.map((c) => c.arrId as number);

        // 1. Bulk tag + unmonitor (one editor call per instance per wave).
        if (!dryRun) {
          try {
            if (mediaType === 'movie') {
              await this.radarr.updateMoviesEditor({
                ...creds,
                movieIds: arrIds,
                ...(tagId ? { tags: [tagId], applyTags: 'add' as const } : {}),
                monitored: false,
              });
            } else {
              await this.sonarr.updateSeriesEditor({
                ...creds,
                seriesIds: arrIds,
                ...(tagId ? { tags: [tagId], applyTags: 'add' as const } : {}),
                monitored: false,
              });
            }
          } catch (err) {
            await log.warn(
              `cutting room prune: bulk tag/unmonitor failed for ${instanceId}: ${(err as Error)?.message ?? String(err)}`,
            );
          }
        }

        // 2. Per-item file deletion (arr-side so hasFile stays consistent and
        //    the arr recycle bin is honored).
        for (const candidate of list) {
          const sizeBytes = Number(candidate.sizeBytes);
          const action = removeEntry
            ? 'entry_removed'
            : 'files_deleted_unmonitored';
          if (dryRun) {
            wouldDelete.push({
              title: `${candidate.title}${candidate.year ? ` (${candidate.year})` : ''}`,
              sizeBytes,
              action,
            });
            pruned += 1;
            bytesFreed += sizeBytes;
            continue;
          }

          try {
            if (removeEntry) {
              if (mediaType === 'movie') {
                await this.radarr.deleteMovie({
                  ...creds,
                  movieId: candidate.arrId as number,
                  deleteFiles: true,
                  addImportExclusion,
                });
              } else {
                await this.sonarr.deleteSeries({
                  ...creds,
                  seriesId: candidate.arrId as number,
                  deleteFiles: true,
                  addImportListExclusion: addImportExclusion,
                });
              }
            } else if (mediaType === 'movie') {
              const fresh = freshMovieById.get(
                `${instanceId}:${candidate.arrId}`,
              );
              if (fresh?.hasFile && fresh.movieFileId > 0) {
                await this.radarr.deleteMovieFile({
                  ...creds,
                  movieFileId: fresh.movieFileId,
                });
              }
            } else {
              const files = await this.sonarr.getEpisodeFiles({
                ...creds,
                seriesId: candidate.arrId as number,
              });
              const fileIds = files.map((f) => f.id);
              if (fileIds.length > 0) {
                try {
                  await this.sonarr.deleteEpisodeFilesBulk({
                    ...creds,
                    episodeFileIds: fileIds,
                  });
                } catch {
                  // Bulk endpoint can be flaky on older Sonarr — fall back
                  // to per-file deletes and tolerate 404s (already gone).
                  for (const fileId of fileIds) {
                    try {
                      await this.sonarr.deleteEpisodeFile({
                        ...creds,
                        episodeFileId: fileId,
                      });
                    } catch (err) {
                      const message = (err as Error)?.message ?? String(err);
                      if (!message.includes('404')) throw err;
                    }
                  }
                }
              }
            }

            await this.prisma.pruneRecord.create({
              data: {
                userId,
                source: 'cuttingRoom',
                mediaType: candidate.mediaType,
                title: candidate.title,
                year: candidate.year,
                sizeBytes: candidate.sizeBytes,
                tmdbId: candidate.tmdbId,
                tvdbId: candidate.tvdbId,
                arrInstanceId: instanceId,
                arrId: candidate.arrId,
                plexRatingKey: candidate.plexRatingKey,
                rootFolderPath: candidate.rootFolderPath,
                snapshotId,
                runId,
                action,
                tagApplied: Boolean(tagId),
              },
            });
            await this.markCandidate(candidate.id, 'pruned', null);
            pruned += 1;
            bytesFreed += sizeBytes;

            if (candidate.path && candidate.librarySectionKey) {
              refreshTargets.add(
                `${candidate.librarySectionKey}|${translatePath(candidate.path, pathMappings)}`,
              );
            }
          } catch (err) {
            failed += 1;
            waveFailures += 1;
            await this.markCandidate(
              candidate.id,
              'failed',
              (err as Error)?.message ?? String(err),
            );
            await log.warn(
              `cutting room prune: failed ${candidate.title}: ${(err as Error)?.message ?? String(err)}`,
            );
          }
        }
      }

      // Plex-only deletes (opt-in).
      for (const candidate of plexOnly) {
        const sizeBytes = Number(candidate.sizeBytes);
        if (dryRun) {
          wouldDelete.push({
            title: `${candidate.title}${candidate.year ? ` (${candidate.year})` : ''}`,
            sizeBytes,
            action: 'plex_only_delete',
          });
          pruned += 1;
          bytesFreed += sizeBytes;
          continue;
        }
        try {
          if (!plexBaseUrl || !plexToken || !candidate.plexRatingKey) {
            throw new Error('Plex is not configured');
          }
          await this.plexServer.deleteMetadataByRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: candidate.plexRatingKey,
          });
          await this.prisma.pruneRecord.create({
            data: {
              userId,
              source: 'cuttingRoom',
              mediaType: candidate.mediaType,
              title: candidate.title,
              year: candidate.year,
              sizeBytes: candidate.sizeBytes,
              tmdbId: candidate.tmdbId,
              tvdbId: candidate.tvdbId,
              plexRatingKey: candidate.plexRatingKey,
              rootFolderPath: candidate.rootFolderPath,
              snapshotId,
              runId,
              action: 'plex_only_delete',
              tagApplied: false,
            },
          });
          await this.markCandidate(candidate.id, 'pruned', null);
          pruned += 1;
          bytesFreed += sizeBytes;
        } catch (err) {
          failed += 1;
          waveFailures += 1;
          await this.markCandidate(
            candidate.id,
            'failed',
            (err as Error)?.message ?? String(err),
          );
        }
      }

      // Targeted Plex refresh for this wave.
      if (!dryRun && plexBaseUrl && plexToken) {
        for (const target of refreshTargets) {
          const [sectionKey, path] = target.split('|');
          try {
            await this.plexServer.refreshLibraryPath({
              baseUrl: plexBaseUrl,
              token: plexToken,
              sectionKey,
              path,
            });
          } catch {
            // Non-fatal; Plex will pick changes up on its own schedule.
          }
        }
      }

      // Abort if the wave failure rate exceeds 50%.
      if (wave.length >= 4 && waveFailures / wave.length > 0.5) {
        await log.warn(
          `cutting room prune: aborting — wave failure rate ${waveFailures}/${wave.length}`,
        );
        stopped = true;
        break;
      }
    }

    // ---- Finalize -----------------------------------------------------------
    if (!dryRun) {
      const remaining = await this.prisma.cuttingRoomCandidate.count({
        where: { snapshotId, selected: true, pruneStatus: 'pending' },
      });
      await this.prisma.cuttingRoomSnapshot.update({
        where: { id: snapshotId },
        data: {
          status: stopped || remaining > 0 || failed > 0 ? 'PARTIAL' : 'PRUNED',
          stopRequested: false,
        },
      });
    }

    return {
      dryRun,
      planned: candidates.length,
      pruned,
      skippedStale,
      skippedPlexOnly,
      failed,
      bytesFreed,
      wavesRun,
      stopped,
      wouldDelete: wouldDelete.slice(0, 200),
    };
  }

  private async markCandidate(
    id: string,
    status: string,
    error: string | null,
  ): Promise<void> {
    await this.prisma.cuttingRoomCandidate
      .update({
        where: { id },
        data: {
          pruneStatus: status,
          pruneError: error,
          ...(status === 'pruned' ? { prunedAt: new Date() } : {}),
        },
      })
      .catch(() => undefined);
  }
}
