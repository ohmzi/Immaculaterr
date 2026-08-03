import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ArrInstanceService } from '../arr-instances/arr-instance.service';
import { PlexServerService } from '../plex/plex-server.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService, type SonarrSeries } from '../sonarr/sonarr.service';
import { CuttingRoomRulesService } from '../cutting-room/cutting-room-rules.service';
import {
  SIZE_CAPPED_EPISODE_PROFILE,
  SIZE_CAPPED_MOVIE_PROFILE,
  buildSizeBlockFormat,
  buildSizeCappedProfile,
  buildSizePreferenceFormat,
} from '../cutting-room/size-capped-profile';
import { derivePathMap, translatePath } from './repair-monitored.job';
import { truncateErrorMessage } from '../log.utils';
import { metricRow, type JobReportV1 } from './job-report-v1';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

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

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

type LargeItemInput = {
  kind: 'movie' | 'episode';
  title: string;
  showTitle: string | null;
  sizeBytes: number;
  path: string | null;
  arrInstanceId: string | null;
  movieId: number | null;
};

/**
 * Replaces oversized files with fresh, smaller downloads: deletes the file,
 * re-monitors exactly what is needed for the re-grab (movies: the movie;
 * episodes: ONLY the affected episodes, their specific seasons, and the show —
 * never the whole series), tags the item `size-reduction`, and triggers a
 * Radarr/Sonarr search. Every mutation honors dry-run.
 */
@Injectable()
export class CuttingRoomLargeFilesJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly arrInstances: ArrInstanceService,
    private readonly plexServer: PlexServerService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
    private readonly rules: CuttingRoomRulesService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const rawItems = Array.isArray(ctx.input?.['items'])
      ? (ctx.input?.['items'] as unknown[])
      : [];
    const items: LargeItemInput[] = rawItems
      .filter(isPlainObject)
      .map((raw) => ({
        kind: raw['kind'] === 'episode' ? 'episode' : 'movie',
        title: typeof raw['title'] === 'string' ? raw['title'] : '(untitled)',
        showTitle:
          typeof raw['showTitle'] === 'string' ? raw['showTitle'] : null,
        sizeBytes: Number(raw['sizeBytes']) || 0,
        path: typeof raw['path'] === 'string' ? raw['path'] : null,
        arrInstanceId:
          typeof raw['arrInstanceId'] === 'string'
            ? raw['arrInstanceId']
            : null,
        movieId: typeof raw['movieId'] === 'number' ? raw['movieId'] : null,
      }));
    if (items.length === 0) {
      throw new Error('cuttingRoomLargeFiles requires input.items');
    }

    const setProgress = (message: string, current: number, total: number) => {
      void ctx
        .patchSummary({
          phase: 'cuttingRoomLargeFiles',
          progress: {
            step: 'replacing',
            message,
            current,
            total,
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
    };

    const rules = await this.rules.getRules(ctx.userId);
    const tagLabel = rules.sizeReductionTagLabel;
    let replaced = 0;
    let failed = 0;
    let freedBytes = 0;
    const detail: Array<{ title: string; bytes: number }> = [];
    const profileNotes = new Map<string, string>();

    // ---- Movies (grouped by Radarr instance) ------------------------------
    const movieItems = items.filter(
      (item) => item.kind === 'movie' && item.movieId,
    );
    const byInstance = new Map<string, LargeItemInput[]>();
    for (const item of movieItems) {
      const key = item.arrInstanceId ?? 'primary-radarr';
      byInstance.set(key, [...(byInstance.get(key) ?? []), item]);
    }

    let progressCount = 0;
    for (const [instanceId, list] of byInstance) {
      let creds: { baseUrl: string; apiKey: string } | null = null;
      try {
        const resolved = await this.arrInstances.resolveInstance(
          ctx.userId,
          'radarr',
          instanceId,
          { requireConfigured: false },
        );
        if (resolved?.baseUrl && resolved?.apiKey) {
          creds = { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey };
        }
      } catch (err) {
        creds = null;
        await ctx.error(
          'large-files: could not resolve Radarr instance — its movies were not replaced',
          { instanceId, items: list.length, error: truncateErrorMessage(err) },
        );
      }
      if (!creds) {
        failed += list.length;
        continue;
      }

      // Tag ensure + fresh file ids.
      let tagId: number | null = null;
      try {
        const tags = await this.radarr.listTags(creds);
        tagId =
          tags.find((t) => t.label.toLowerCase() === tagLabel)?.id ?? null;
        if (!tagId && !ctx.dryRun) {
          tagId = (await this.radarr.createTag({ ...creds, label: tagLabel }))
            .id;
        }
      } catch (err) {
        tagId = null;
        await ctx.warn(
          'large-files: size-reduction tag could not be ensured — items are replaced without the tag',
          { instanceId, error: truncateErrorMessage(err) },
        );
      }
      let movieProfile: {
        id: number | null;
        name: string;
        created: boolean;
      } | null = null;
      try {
        movieProfile = await this.ensureSizeCappedProfile({
          app: 'radarr',
          creds,
          dryRun: ctx.dryRun,
        });
        profileNotes.set(
          'movies',
          movieProfile.id === null
            ? `would create + switch to "${movieProfile.name}"`
            : `${movieProfile.created ? 'created' : 'reusing'} "${movieProfile.name}"`,
        );
      } catch (err) {
        movieProfile = null;
        await ctx.warn(
          `large-files: size-capped profile for ${instanceId} failed: ${truncateErrorMessage(err)}`,
        );
      }

      // Without fresh file ids nothing can be deleted safely — treat the
      // whole instance batch as failed instead of faking replacements.
      const fresh = new Map<number, { movieFileId: number }>();
      let freshLoaded = false;
      try {
        for (const movie of await this.radarr.listMovies(creds)) {
          fresh.set(movie.id, {
            movieFileId:
              typeof movie.movieFileId === 'number' ? movie.movieFileId : 0,
          });
        }
        freshLoaded = true;
      } catch (err) {
        await ctx.error(
          'large-files: Radarr movie listing failed — its items were not replaced',
          { instanceId, items: list.length, error: truncateErrorMessage(err) },
        );
      }
      if (!freshLoaded && !ctx.dryRun) {
        failed += list.length;
        continue;
      }

      const movieIds = list.map((item) => item.movieId as number);
      if (!ctx.dryRun) {
        try {
          // Re-monitor + tag in one bulk call, then delete files and search.
          await this.radarr.updateMoviesEditor({
            ...creds,
            movieIds,
            monitored: true,
            ...(tagId ? { tags: [tagId], applyTags: 'add' as const } : {}),
            ...(movieProfile?.id ? { qualityProfileId: movieProfile.id } : {}),
          });
        } catch (err) {
          await ctx.warn(
            `large-files: bulk monitor/tag failed for ${instanceId}: ${truncateErrorMessage(err)}`,
          );
        }
      }

      const searchIds: number[] = [];
      for (const item of list) {
        progressCount += 1;
        setProgress(
          `${ctx.dryRun ? 'Rehearsing' : 'Replacing'} ${item.title}…`,
          progressCount,
          items.length,
        );
        if (ctx.dryRun) {
          replaced += 1;
          freedBytes += item.sizeBytes;
          detail.push({ title: item.title, bytes: item.sizeBytes });
          continue;
        }
        try {
          const fileId = fresh.get(item.movieId as number)?.movieFileId ?? 0;
          if (fileId <= 0) {
            failed += 1;
            await ctx.warn(
              `large-files: ${item.title} skipped — Radarr no longer reports a movie file for it`,
              { movieId: item.movieId, instanceId },
            );
            continue;
          }
          await this.radarr.deleteMovieFile({
            ...creds,
            movieFileId: fileId,
          });
          searchIds.push(item.movieId as number);
          replaced += 1;
          freedBytes += item.sizeBytes;
          detail.push({ title: item.title, bytes: item.sizeBytes });
          await this.prisma.pruneRecord.create({
            data: {
              userId: ctx.userId,
              source: 'large-files',
              mediaType: 'movie',
              title: item.title,
              sizeBytes: BigInt(Math.round(item.sizeBytes)),
              arrInstanceId: instanceId,
              arrId: item.movieId,
              runId: ctx.runId,
              action: 'replaced_for_size',
              tagApplied: Boolean(tagId),
            },
          });
        } catch (err) {
          failed += 1;
          await ctx.warn(
            `large-files: ${item.title} failed: ${truncateErrorMessage(err)}`,
          );
        }
      }
      if (!ctx.dryRun && searchIds.length > 0) {
        try {
          await this.radarr.searchMovies({ ...creds, movieIds: searchIds });
        } catch (err) {
          await ctx.warn(
            `large-files: Radarr search failed: ${truncateErrorMessage(err)}`,
          );
        }
      }
    }

    // ---- Episodes (resolved against Sonarr by path) ------------------------
    const episodeItems = items.filter(
      (item) => item.kind === 'episode' && item.path,
    );
    if (episodeItems.length > 0) {
      const result = await this.replaceEpisodes({
        ctx,
        episodeItems,
        tagLabel,
        profileNotes,
        setProgress,
        progressOffset: progressCount,
        totalItems: items.length,
      });
      replaced += result.replaced;
      failed += result.failed;
      freedBytes += result.freedBytes;
      detail.push(...result.detail);
    }

    const verb = ctx.dryRun ? 'Would replace' : 'Replaced';
    const report: JobReportV1 = {
      template: 'jobReportV1',
      version: 1,
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      headline: `${verb} ${replaced} oversized file(s) (${formatGb(freedBytes)}) — re-searching for smaller copies`,
      sections: [
        {
          id: 'result',
          title: 'Large file replacement',
          rows: [
            metricRow({
              label: verb,
              start: null,
              changed: null,
              end: replaced,
              unit: 'files',
              note: formatGb(freedBytes),
            }),
            metricRow({
              label: 'Failed',
              start: null,
              changed: null,
              end: failed,
              unit: 'items',
            }),
            ...Array.from(profileNotes.entries()).map(([scope, note]) =>
              metricRow({
                label:
                  scope === 'movies'
                    ? 'Movie quality profile'
                    : 'Episode quality profile',
                start: null,
                changed: null,
                end: null,
                note,
              }),
            ),
          ],
        },
      ],
      tasks: [
        {
          id: 'replace',
          title: 'Replace oversized files',
          // Honest status: if nothing was replaced and anything failed, the
          // run itself must fail rather than reporting success.
          status:
            failed > 0 && replaced === 0
              ? ('failed' as const)
              : ('success' as const),
          facts: [
            { label: verb, value: `${replaced} file(s)` },
            { label: 'Failed', value: `${failed} item(s)` },
            { label: 'Freed', value: formatGb(freedBytes) },
          ],
          ...(failed > 0 && replaced === 0
            ? {
                issues: [
                  {
                    level: 'error' as const,
                    message:
                      'No files were replaced — every selected item failed. See the run logs for the failing endpoint details.',
                  },
                ],
              }
            : {}),
        },
        ...detail.slice(0, 50).map((row, index) => ({
          id: `large-${index}`,
          title: `${verb}: ${row.title}`,
          status: 'success' as const,
          facts: [{ label: 'Size', value: formatGb(row.bytes) }],
        })),
      ],
      issues:
        failed > 0
          ? [
              {
                level: 'warn',
                message: `${failed} item(s) failed — files kept; see logs.`,
              },
            ]
          : [],
      raw: {
        requested: items.length,
        replaced,
        failed,
        freedBytes,
        profiles: Object.fromEntries(profileNotes),
      },
    };
    return { summary: report as unknown as JsonObject };
  }

  /**
   * Finds the size-capped quality profile by name and reuses it; on a real
   * run, missing custom formats and the profile itself are created first.
   * Dry-run never creates anything — a missing profile reports id=null so the
   * caller can say "would create".
   */
  private async ensureSizeCappedProfile(params: {
    app: 'radarr' | 'sonarr';
    creds: { baseUrl: string; apiKey: string };
    dryRun: boolean;
  }): Promise<{ id: number | null; name: string; created: boolean }> {
    const svc = params.app === 'radarr' ? this.radarr : this.sonarr;
    const spec =
      params.app === 'radarr'
        ? SIZE_CAPPED_MOVIE_PROFILE
        : SIZE_CAPPED_EPISODE_PROFILE;

    const profiles = await svc.listQualityProfiles(params.creds);
    const existing = profiles.find((p) => p.name === spec.profileName);
    if (existing) {
      return { id: existing.id, name: existing.name, created: false };
    }
    if (params.dryRun) {
      return { id: null, name: spec.profileName, created: false };
    }

    const formats = await svc.listCustomFormats(params.creds);
    const scores = new Map<number, number>();
    let block = formats.find((f) => f.name === spec.blockFormatName) ?? null;
    if (!block) {
      block = await svc.createCustomFormat({
        ...params.creds,
        format: buildSizeBlockFormat(spec.blockFormatName, spec.capGb),
      });
    }
    scores.set(block.id, -10000);
    if (spec.idealFormatName) {
      let ideal = formats.find((f) => f.name === spec.idealFormatName) ?? null;
      if (!ideal) {
        ideal = await svc.createCustomFormat({
          ...params.creds,
          format: buildSizePreferenceFormat(
            spec.idealFormatName,
            spec.idealMinGb,
            spec.idealMaxGb,
          ),
        });
      }
      scores.set(ideal.id, 50);
    }

    const allFormats = await svc.listCustomFormats(params.creds);
    const schema = await svc.getQualityProfileSchema(params.creds);
    const created = await svc.createQualityProfile({
      ...params.creds,
      profile: buildSizeCappedProfile({
        name: spec.profileName,
        schema,
        formats: allFormats,
        formatScores: scores,
      }),
    });
    return { id: created.id, name: spec.profileName, created: true };
  }

  private async replaceEpisodes(params: {
    ctx: JobContext;
    episodeItems: LargeItemInput[];
    tagLabel: string;
    profileNotes: Map<string, string>;
    setProgress: (message: string, current: number, total: number) => void;
    progressOffset: number;
    totalItems: number;
  }) {
    const {
      ctx,
      episodeItems,
      tagLabel,
      profileNotes,
      setProgress,
      totalItems,
    } = params;
    let replaced = 0;
    let failed = 0;
    let freedBytes = 0;
    const detail: Array<{ title: string; bytes: number }> = [];
    let progressCount = params.progressOffset;

    let creds: { baseUrl: string; apiKey: string } | null = null;
    try {
      const resolved = await this.arrInstances.resolveInstance(
        ctx.userId,
        'sonarr',
        null,
        { requireConfigured: false },
      );
      if (resolved?.baseUrl && resolved?.apiKey) {
        creds = { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey };
      }
    } catch {
      creds = null;
    }
    if (!creds) {
      await ctx.warn(
        'large-files: Sonarr is not configured — episodes skipped',
      );
      return { replaced, failed: episodeItems.length, freedBytes, detail };
    }

    // Path translation: Plex namespace -> Sonarr namespace.
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);
    const plexBaseUrl =
      pickString(settings, 'plex.baseUrl') ?? pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') ?? pickString(secrets, 'plexToken');
    let mappings: ReturnType<typeof derivePathMap> = [];
    try {
      const series = await this.sonarr.listSeries(creds);
      const arrRoots = Array.from(
        new Set(
          series
            .map((s) => s.rootFolderPath ?? '')
            .filter((value) => value.length > 0),
        ),
      );
      if (plexBaseUrl && plexToken) {
        const locations = await this.plexServer.getSectionLocations({
          baseUrl: plexBaseUrl,
          token: plexToken,
        });
        const plexPaths: string[] = [];
        for (const info of locations.values())
          plexPaths.push(...info.locations);
        mappings = derivePathMap(plexPaths, arrRoots);
      }

      // Tag ensure once.
      let tagId: number | null = null;
      try {
        const tags = await this.sonarr.listTags(creds);
        tagId =
          tags.find((t) => t.label.toLowerCase() === tagLabel)?.id ?? null;
        if (!tagId && !ctx.dryRun) {
          tagId = (await this.sonarr.createTag({ ...creds, label: tagLabel }))
            .id;
        }
      } catch (err) {
        tagId = null;
        await ctx.warn(
          'large-files: size-reduction tag could not be ensured — items are replaced without the tag',
          { app: 'sonarr', error: truncateErrorMessage(err) },
        );
      }

      let episodeProfile: {
        id: number | null;
        name: string;
        created: boolean;
      } | null = null;
      try {
        episodeProfile = await this.ensureSizeCappedProfile({
          app: 'sonarr',
          creds,
          dryRun: ctx.dryRun,
        });
        profileNotes.set(
          'episodes',
          episodeProfile.id === null
            ? `would create + switch to "${episodeProfile.name}"`
            : `${episodeProfile.created ? 'created' : 'reusing'} "${episodeProfile.name}"`,
        );
      } catch (err) {
        episodeProfile = null;
        await ctx.warn(
          `large-files: size-capped Sonarr profile failed: ${truncateErrorMessage(err)}`,
        );
      }

      // Group items by their owning series via path prefix.
      const sortedSeries = series
        .filter((s) => typeof s.path === 'string' && s.path)
        .sort((a, b) => (b.path as string).length - (a.path as string).length);
      const bySeries = new Map<
        number,
        {
          series: SonarrSeries;
          items: Array<LargeItemInput & { arrPath: string }>;
        }
      >();
      for (const item of episodeItems) {
        const arrPath = translatePath(item.path as string, mappings);
        const owner = sortedSeries.find((s) =>
          arrPath.startsWith(`${(s.path as string).replace(/\/+$/, '')}/`),
        );
        if (!owner) {
          failed += 1;
          await ctx.warn(
            `large-files: no Sonarr series matches ${item.showTitle ?? item.title} (${arrPath})`,
          );
          continue;
        }
        const bucket = bySeries.get(owner.id) ?? { series: owner, items: [] };
        bucket.items.push({ ...item, arrPath });
        bySeries.set(owner.id, bucket);
      }

      for (const { series: show, items: list } of bySeries.values()) {
        // Resolve episode files + episodes for THIS series only.
        const files = await this.sonarr.getEpisodeFiles({
          ...creds,
          seriesId: show.id,
        });
        const episodes = await this.sonarr.getEpisodesBySeries({
          ...creds,
          seriesId: show.id,
        });

        const affected: Array<{
          item: LargeItemInput & { arrPath: string };
          fileId: number;
          episodeIds: number[];
          seasonNumbers: Set<number>;
        }> = [];
        const seenFileIds = new Set<number>();
        for (const item of list) {
          const file = files.find((f) => f.path === item.arrPath);
          if (!file) {
            failed += 1;
            await ctx.warn(
              `large-files: Sonarr has no file record for ${item.arrPath}`,
            );
            continue;
          }
          // Double episodes share one file — delete and count it exactly once.
          if (seenFileIds.has(file.id)) continue;
          seenFileIds.add(file.id);
          const fileEpisodes = episodes.filter(
            (e) => e.episodeFileId === file.id,
          );
          affected.push({
            item,
            fileId: file.id,
            episodeIds: fileEpisodes.map((e) => e.id),
            seasonNumbers: new Set(
              fileEpisodes
                .map((e) => e.seasonNumber)
                .filter((n): n is number => typeof n === 'number'),
            ),
          });
        }
        if (affected.length === 0) continue;

        // Re-monitor precisely: the show + ONLY the affected seasons — other
        // seasons and episodes keep their current monitored state.
        const affectedSeasons = new Set<number>();
        for (const entry of affected) {
          for (const season of entry.seasonNumbers) affectedSeasons.add(season);
        }
        if (!ctx.dryRun) {
          try {
            const updated: SonarrSeries = {
              ...show,
              monitored: true,
              ...(episodeProfile?.id
                ? { qualityProfileId: episodeProfile.id }
                : {}),
              tags: tagId
                ? Array.from(new Set([...(show.tags ?? []), tagId]))
                : show.tags,
              seasons: (show.seasons ?? []).map((season) =>
                typeof season.seasonNumber === 'number' &&
                affectedSeasons.has(season.seasonNumber)
                  ? { ...season, monitored: true }
                  : season,
              ),
            };
            await this.sonarr.updateSeries({ ...creds, series: updated });
          } catch (err) {
            await ctx.warn(
              `large-files: monitor/tag series "${show.title}" failed: ${truncateErrorMessage(err)}`,
            );
          }
        }

        const searchEpisodeIds: number[] = [];
        for (const entry of affected) {
          progressCount += 1;
          setProgress(
            `${ctx.dryRun ? 'Rehearsing' : 'Replacing'} ${entry.item.showTitle ?? show.title} — ${entry.item.title}…`,
            progressCount,
            totalItems,
          );
          if (ctx.dryRun) {
            replaced += 1;
            freedBytes += entry.item.sizeBytes;
            detail.push({
              title: `${entry.item.showTitle ?? show.title} — ${entry.item.title}`,
              bytes: entry.item.sizeBytes,
            });
            continue;
          }
          try {
            // Monitor ONLY the affected episodes.
            for (const episodeId of entry.episodeIds) {
              const episode = episodes.find((e) => e.id === episodeId);
              if (episode && !episode.monitored) {
                await this.sonarr.setEpisodeMonitored({
                  ...creds,
                  episode,
                  monitored: true,
                });
              }
            }
            await this.sonarr.deleteEpisodeFile({
              ...creds,
              episodeFileId: entry.fileId,
            });
            searchEpisodeIds.push(...entry.episodeIds);
            replaced += 1;
            freedBytes += entry.item.sizeBytes;
            detail.push({
              title: `${entry.item.showTitle ?? show.title} — ${entry.item.title}`,
              bytes: entry.item.sizeBytes,
            });
            await this.prisma.pruneRecord.create({
              data: {
                userId: ctx.userId,
                source: 'large-files',
                mediaType: 'show',
                title: `${entry.item.showTitle ?? show.title} — ${entry.item.title}`,
                sizeBytes: BigInt(Math.round(entry.item.sizeBytes)),
                arrId: show.id,
                runId: ctx.runId,
                action: 'replaced_for_size',
                tagApplied: Boolean(tagId),
              },
            });
          } catch (err) {
            failed += 1;
            await ctx.warn(
              `large-files: ${entry.item.title} failed: ${truncateErrorMessage(err)}`,
            );
          }
        }
        if (!ctx.dryRun && searchEpisodeIds.length > 0) {
          try {
            await this.sonarr.searchEpisodes({
              ...creds,
              episodeIds: searchEpisodeIds,
            });
          } catch (err) {
            await ctx.warn(
              `large-files: Sonarr search failed for "${show.title}": ${truncateErrorMessage(err)}`,
            );
          }
        }
      }
    } catch (err) {
      await ctx.warn(
        `large-files: episode pass failed: ${truncateErrorMessage(err)}`,
      );
      failed += episodeItems.length - replaced;
    }

    return { replaced, failed, freedBytes, detail };
  }
}
