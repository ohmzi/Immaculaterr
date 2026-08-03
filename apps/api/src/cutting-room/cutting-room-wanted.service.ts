import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { ArrInstanceService } from '../arr-instances/arr-instance.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';

export type WantedItem = {
  arrId: number;
  title: string;
  year: number | null;
  added: string | null;
  tmdbId: number | null;
  tvdbId: number | null;
};

export type WantedPruneSummary = {
  dryRun: boolean;
  planned: number;
  changed: number;
  failed: number;
  mode: 'unmonitor' | 'remove';
};

const EDITOR_CHUNK = 200;

/**
 * "Wanted list" = monitored arr entries that never downloaded anything.
 * Pruning them stops future downloads; by construction no file is ever touched
 * (unmonitor flips a flag; remove deletes the entry with deleteFiles=false).
 */
@Injectable()
export class CuttingRoomWantedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arrInstances: ArrInstanceService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
  ) {}

  async listWanted(params: {
    userId: string;
    type: 'radarr' | 'sonarr';
    instanceId?: string | null;
  }): Promise<WantedItem[]> {
    const inst = await this.arrInstances.resolveInstance(
      params.userId,
      params.type,
      params.instanceId ?? null,
      { requireConfigured: false },
    );
    if (!inst?.baseUrl || !inst?.apiKey) return [];
    const creds = { baseUrl: inst.baseUrl, apiKey: inst.apiKey };

    if (params.type === 'radarr') {
      const movies = await this.radarr.listMovies(creds);
      return movies
        .filter((m) => Boolean(m.monitored) && !m.hasFile)
        .map((m) => ({
          arrId: m.id,
          title: m.title ?? '(untitled)',
          year: typeof m.year === 'number' ? m.year : null,
          added: typeof m.added === 'string' ? m.added : null,
          tmdbId: typeof m.tmdbId === 'number' ? m.tmdbId : null,
          tvdbId: null,
        }));
    }

    const series = await this.sonarr.listSeries(creds);
    return series
      .filter(
        (s) =>
          Boolean(s.monitored) && (s.statistics?.episodeFileCount ?? 0) === 0,
      )
      .map((s) => ({
        arrId: s.id,
        title: s.title ?? '(untitled)',
        year: typeof s.year === 'number' ? s.year : null,
        added: typeof s.added === 'string' ? s.added : null,
        tmdbId: null,
        tvdbId: typeof s.tvdbId === 'number' ? s.tvdbId : null,
      }));
  }

  async pruneWanted(params: {
    userId: string;
    runId: string;
    type: 'radarr' | 'sonarr';
    instanceId?: string | null;
    arrIds: number[] | 'all';
    mode: 'unmonitor' | 'remove';
    addImportExclusion: boolean;
    dryRun: boolean;
    progress: (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
    }) => void;
  }): Promise<WantedPruneSummary> {
    const { userId, runId, type, mode, addImportExclusion, dryRun } = params;
    const inst = await this.arrInstances.resolveInstance(
      userId,
      type,
      params.instanceId ?? null,
      { requireConfigured: false },
    );
    if (!inst?.baseUrl || !inst?.apiKey) {
      throw new Error(`${type} is not configured`);
    }
    const creds = { baseUrl: inst.baseUrl, apiKey: inst.apiKey };
    const instanceId = inst.id ?? params.instanceId ?? `primary-${type}`;

    const wanted = await this.listWanted({
      userId,
      type,
      instanceId: params.instanceId ?? null,
    });
    const byId = new Map(wanted.map((w) => [w.arrId, w]));
    const targets =
      params.arrIds === 'all'
        ? wanted
        : params.arrIds
            .map((id) => byId.get(id))
            .filter((w): w is WantedItem => Boolean(w));

    let changed = 0;
    let failed = 0;

    if (mode === 'unmonitor') {
      for (let i = 0; i < targets.length; i += EDITOR_CHUNK) {
        const chunk = targets.slice(i, i + EDITOR_CHUNK);
        params.progress({
          step: 'unmonitoring',
          message: `${dryRun ? 'Would unmonitor' : 'Unmonitoring'} ${Math.min(i + EDITOR_CHUNK, targets.length)}/${targets.length}…`,
          current: Math.min(i + EDITOR_CHUNK, targets.length),
          total: targets.length,
        });
        if (dryRun) {
          changed += chunk.length;
          continue;
        }
        try {
          if (type === 'radarr') {
            await this.radarr.updateMoviesEditor({
              ...creds,
              movieIds: chunk.map((w) => w.arrId),
              monitored: false,
            });
          } else {
            await this.sonarr.updateSeriesEditor({
              ...creds,
              seriesIds: chunk.map((w) => w.arrId),
              monitored: false,
            });
          }
          changed += chunk.length;
          await this.recordChunk(
            userId,
            runId,
            type,
            instanceId,
            chunk,
            'unmonitored_only',
          );
        } catch {
          failed += chunk.length;
        }
      }
    } else {
      for (let i = 0; i < targets.length; i += 1) {
        const item = targets[i];
        if (i % 25 === 0) {
          params.progress({
            step: 'removing',
            message: `${dryRun ? 'Would remove' : 'Removing'} ${i + 1}/${targets.length}…`,
            current: i + 1,
            total: targets.length,
          });
        }
        if (dryRun) {
          changed += 1;
          continue;
        }
        try {
          if (type === 'radarr') {
            await this.radarr.deleteMovie({
              ...creds,
              movieId: item.arrId,
              deleteFiles: false,
              addImportExclusion,
            });
          } else {
            await this.sonarr.deleteSeries({
              ...creds,
              seriesId: item.arrId,
              deleteFiles: false,
              addImportListExclusion: addImportExclusion,
            });
          }
          changed += 1;
          await this.recordChunk(
            userId,
            runId,
            type,
            instanceId,
            [item],
            'entry_removed',
          );
        } catch {
          failed += 1;
        }
      }
    }

    return { dryRun, planned: targets.length, changed, failed, mode };
  }

  private async recordChunk(
    userId: string,
    runId: string,
    type: 'radarr' | 'sonarr',
    instanceId: string,
    items: WantedItem[],
    action: string,
  ): Promise<void> {
    await this.prisma.pruneRecord
      .createMany({
        data: items.map((item) => ({
          userId,
          source: 'wanted',
          mediaType: type === 'radarr' ? 'movie' : 'show',
          title: item.title,
          year: item.year,
          sizeBytes: BigInt(0),
          tmdbId: item.tmdbId,
          tvdbId: item.tvdbId,
          arrInstanceId: instanceId,
          arrId: item.arrId,
          runId,
          action,
          tagApplied: false,
        })),
      })
      .catch(() => undefined);
  }
}
