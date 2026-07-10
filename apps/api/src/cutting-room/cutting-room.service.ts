import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ArrInstanceService } from '../arr-instances/arr-instance.service';
import { PlexServerService } from '../plex/plex-server.service';
import type { PlexSectionWithLocations } from '../plex/plex-server.service';
import {
  derivePathMap,
  translatePath,
  type PathPrefixMapping,
} from '../jobs/repair-monitored.job';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';
import { CuttingRoomAnalysisService } from './cutting-room-analysis.service';
import { CuttingRoomRulesService } from './cutting-room-rules.service';

export type CandidateSort = 'score' | 'size' | 'scorePerGb' | 'addedAt';

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

function serializeSnapshot(row: {
  id: string;
  kind: string;
  mediaType: string;
  status: string;
  rulesJson: unknown;
  sectionKeys: unknown;
  analyzeRunId: string | null;
  pruneRunId: string | null;
  stopRequested: boolean;
  targetBytes: bigint | null;
  libraryCount: number;
  libraryBytes: bigint;
  candidateCount: number;
  candidateBytes: bigint;
  selectedCount: number;
  selectedBytes: bigint;
  protectedJson: unknown;
  tierJson: unknown;
  errorMessage: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}) {
  return {
    id: row.id,
    kind: row.kind,
    mediaType: row.mediaType,
    status: row.status,
    rules: row.rulesJson ?? null,
    scope: row.sectionKeys ?? null,
    analyzeRunId: row.analyzeRunId,
    pruneRunId: row.pruneRunId,
    stopRequested: row.stopRequested,
    targetBytes: row.targetBytes !== null ? Number(row.targetBytes) : null,
    libraryCount: row.libraryCount,
    libraryBytes: Number(row.libraryBytes),
    candidateCount: row.candidateCount,
    candidateBytes: Number(row.candidateBytes),
    selectedCount: row.selectedCount,
    selectedBytes: Number(row.selectedBytes),
    protectedCounts: row.protectedJson ?? {},
    tiers: row.tierJson ?? {},
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

function serializeCandidate(row: {
  id: string;
  mediaType: string;
  title: string;
  year: number | null;
  tier: number;
  score: number;
  sizeBytes: bigint;
  fileCount: number;
  watchStatus: string;
  confidence: string;
  plexRatingKey: string | null;
  librarySectionKey: string | null;
  tmdbId: number | null;
  tvdbId: number | null;
  arrInstanceId: string | null;
  arrId: number | null;
  monitored: boolean | null;
  rootFolderPath: string | null;
  path: string | null;
  addedAt: Date | null;
  lastWatchedAt: Date | null;
  rating: number | null;
  reasonsJson: unknown;
  selected: boolean;
  pruneStatus: string;
  pruneError: string | null;
}) {
  return {
    id: row.id,
    mediaType: row.mediaType,
    title: row.title,
    year: row.year,
    tier: row.tier,
    score: row.score,
    sizeBytes: Number(row.sizeBytes),
    fileCount: row.fileCount,
    watchStatus: row.watchStatus,
    confidence: row.confidence,
    plexRatingKey: row.plexRatingKey,
    librarySectionKey: row.librarySectionKey,
    tmdbId: row.tmdbId,
    tvdbId: row.tvdbId,
    arrInstanceId: row.arrInstanceId,
    arrId: row.arrId,
    monitored: row.monitored,
    rootFolderPath: row.rootFolderPath,
    path: row.path,
    addedAt: row.addedAt ? row.addedAt.toISOString() : null,
    lastWatchedAt: row.lastWatchedAt ? row.lastWatchedAt.toISOString() : null,
    rating: row.rating,
    reasons: row.reasonsJson ?? [],
    selected: row.selected,
    pruneStatus: row.pruneStatus,
    pruneError: row.pruneError,
  };
}

const CANDIDATE_SELECT = {
  id: true,
  mediaType: true,
  title: true,
  year: true,
  tier: true,
  score: true,
  sizeBytes: true,
  fileCount: true,
  watchStatus: true,
  confidence: true,
  plexRatingKey: true,
  librarySectionKey: true,
  tmdbId: true,
  tvdbId: true,
  arrInstanceId: true,
  arrId: true,
  monitored: true,
  rootFolderPath: true,
  path: true,
  addedAt: true,
  lastWatchedAt: true,
  rating: true,
  reasonsJson: true,
  selected: true,
  pruneStatus: true,
  pruneError: true,
} as const;

export type LargeFileListItem = {
  kind: 'movie' | 'episode';
  title: string;
  showTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  sizeBytes: number;
  path: string | null;
  arrInstanceId: string | null;
  movieId: number | null;
  plexRatingKey: string | null;
};

/**
 * A single file can back several Plex episodes (double episodes, specials).
 * Collapse those to one row per file so sizes are not double-counted and the
 * replacement job deletes each file exactly once.
 */
export function dedupeEpisodesByFile(
  items: LargeFileListItem[],
): LargeFileListItem[] {
  const out: LargeFileListItem[] = [];
  const byPath = new Map<string, { item: LargeFileListItem; extra: number }>();
  for (const item of items) {
    if (item.kind !== 'episode' || !item.path) {
      out.push(item);
      continue;
    }
    const existing = byPath.get(item.path);
    if (!existing) {
      byPath.set(item.path, { item: { ...item }, extra: 0 });
    } else {
      existing.extra += 1;
    }
  }
  for (const { item, extra } of byPath.values()) {
    out.push(
      extra > 0
        ? { ...item, title: `${item.title} (+${extra} more in this file)` }
        : item,
    );
  }
  return out;
}

@Injectable()
export class CuttingRoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly arrInstances: ArrInstanceService,
    private readonly plexServer: PlexServerService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
    private readonly analysis: CuttingRoomAnalysisService,
    private readonly rules: CuttingRoomRulesService,
  ) {}

  // ---- Prereqs / environment ------------------------------------------------

  async getPrereqs(userId: string) {
    const rules = await this.rules.getRules(userId);
    const tautulli = await this.analysis.tautulliConfigured(userId);
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const plexConfigured = Boolean(
      (pickString(settings, 'plex.baseUrl') ??
        pickString(settings, 'plex.url')) &&
      (pickString(secrets, 'plex.token') ?? pickString(secrets, 'plexToken')),
    );
    return {
      plexConfigured,
      tautulli: {
        configured: tautulli.configured,
        required: rules.requireTautulli,
      },
    };
  }

  async listPlexLibraries(userId: string, mediaType: 'movie' | 'show') {
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const baseUrl =
      pickString(settings, 'plex.baseUrl') ?? pickString(settings, 'plex.url');
    const token =
      pickString(secrets, 'plex.token') ?? pickString(secrets, 'plexToken');
    if (!baseUrl || !token) {
      throw new BadRequestException('Plex is not configured');
    }
    const sections = await this.plexServer.getSections({ baseUrl, token });
    return sections
      .filter((s) => (s.type ?? '').toLowerCase() === mediaType)
      .map((s) => ({ key: s.key, title: s.title }));
  }

  async getDiskSpace(userId: string, type: 'radarr' | 'sonarr') {
    const instances = await this.arrInstances.list(userId, type);
    const out: Array<{
      instanceId: string;
      path: string;
      label: string | null;
      freeSpace: number;
      totalSpace: number;
    }> = [];
    for (const instance of instances) {
      try {
        const resolved = await this.arrInstances.resolveInstance(
          userId,
          type,
          instance.id,
          { requireConfigured: false },
        );
        if (!resolved?.baseUrl || !resolved?.apiKey) continue;
        const creds = { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey };
        const disks =
          type === 'radarr'
            ? await this.radarr.getDiskSpace(creds)
            : await this.sonarr.getDiskSpace(creds);
        for (const disk of disks) {
          out.push({ instanceId: instance.id, ...disk });
        }
      } catch {
        // Instance offline — skip its gauges.
      }
    }
    // Dedupe identical mount paths across instances.
    const seen = new Set<string>();
    return out.filter((d) => {
      if (seen.has(d.path)) return false;
      seen.add(d.path);
      return true;
    });
  }

  async getRecycleBinInfo(userId: string, type: 'radarr' | 'sonarr') {
    try {
      const resolved = await this.arrInstances.resolveInstance(
        userId,
        type,
        null,
        { requireConfigured: false },
      );
      if (!resolved?.baseUrl || !resolved?.apiKey) return { configured: null };
      const creds = { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey };
      const path =
        type === 'radarr'
          ? await this.radarr.getRecycleBinPath(creds)
          : await this.sonarr.getRecycleBinPath(creds);
      return { configured: Boolean(path), path };
    } catch {
      return { configured: null };
    }
  }

  // ---- Snapshots --------------------------------------------------------------

  async createSnapshot(params: {
    userId: string;
    mediaType: 'movie' | 'show';
    sectionKeys: string[];
    instanceIds: string[];
    rulesOverride?: Record<string, unknown>;
  }) {
    const rules = params.rulesOverride
      ? await this.rules.updateRules(params.userId, params.rulesOverride)
      : await this.rules.getRules(params.userId);

    if (params.sectionKeys.length === 0) {
      throw new BadRequestException('Select at least one Plex library');
    }

    const snapshot = await this.prisma.cuttingRoomSnapshot.create({
      data: {
        userId: params.userId,
        kind: 'interactive',
        mediaType: params.mediaType,
        status: 'PENDING',
        rulesJson: rules as unknown as Prisma.InputJsonValue,
        sectionKeys: {
          sections: params.sectionKeys,
          instances: params.instanceIds,
        },
      },
    });
    return snapshot.id;
  }

  async listSnapshots(userId: string, take: number) {
    const rows = await this.prisma.cuttingRoomSnapshot.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(50, Math.max(1, take)),
    });
    return rows.map(serializeSnapshot);
  }

  async getSnapshot(userId: string, snapshotId: string) {
    const row = await this.prisma.cuttingRoomSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Snapshot not found');
    }
    // Live selected aggregates (selection changes after snapshot creation).
    const selected = await this.prisma.cuttingRoomCandidate.aggregate({
      where: { snapshotId, selected: true, pruneStatus: 'pending' },
      _count: { id: true },
      _sum: { sizeBytes: true },
    });
    const serialized = serializeSnapshot(row);
    serialized.selectedCount = selected._count.id;
    serialized.selectedBytes = Number(selected._sum.sizeBytes ?? 0);
    return serialized;
  }

  // ---- Candidates ---------------------------------------------------------------

  async listCandidates(params: {
    userId: string;
    snapshotId: string;
    take: number;
    skip: number;
    sort: CandidateSort;
    dir: 'asc' | 'desc';
    maxTier?: number;
    minScore?: number;
    rootFolder?: string;
    watchStatus?: string;
    search?: string;
    selectedOnly?: boolean;
  }) {
    await this.assertSnapshotOwned(params.userId, params.snapshotId);

    const where: Record<string, unknown> = { snapshotId: params.snapshotId };
    if (params.maxTier) where['tier'] = { lte: params.maxTier };
    if (params.minScore) where['score'] = { gte: params.minScore };
    if (params.rootFolder) where['rootFolderPath'] = params.rootFolder;
    if (params.watchStatus) where['watchStatus'] = params.watchStatus;
    if (params.selectedOnly) where['selected'] = true;
    if (params.search) {
      where['title'] = { contains: params.search };
    }

    const orderBy: Array<Record<string, 'asc' | 'desc'>> = [];
    if (params.sort === 'score') orderBy.push({ score: params.dir });
    else if (params.sort === 'size') orderBy.push({ sizeBytes: params.dir });
    else if (params.sort === 'addedAt') orderBy.push({ addedAt: params.dir });
    // scorePerGb sorts in memory below.
    orderBy.push({ id: 'asc' });

    const take = Math.min(200, Math.max(1, params.take));

    if (params.sort === 'scorePerGb') {
      // Bounded in-memory sort: pull matching rows' sort fields only.
      const rows = await this.prisma.cuttingRoomCandidate.findMany({
        where: where as never,
        select: { id: true, score: true, sizeBytes: true },
      });
      rows.sort((a, b) => {
        const ra = a.score / Math.max(1, Number(a.sizeBytes) / 1e9);
        const rb = b.score / Math.max(1, Number(b.sizeBytes) / 1e9);
        return params.dir === 'asc' ? ra - rb : rb - ra;
      });
      const pageIds = rows
        .slice(params.skip, params.skip + take)
        .map((r) => r.id);
      const page = await this.prisma.cuttingRoomCandidate.findMany({
        where: { id: { in: pageIds } },
        select: CANDIDATE_SELECT,
      });
      const byId = new Map(page.map((r) => [r.id, r]));
      return {
        total: rows.length,
        items: pageIds
          .map((id) => byId.get(id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .map(serializeCandidate),
      };
    }

    const [total, page] = await Promise.all([
      this.prisma.cuttingRoomCandidate.count({ where: where as never }),
      this.prisma.cuttingRoomCandidate.findMany({
        where: where as never,
        orderBy,
        skip: Math.max(0, params.skip),
        take,
        select: CANDIDATE_SELECT,
      }),
    ]);
    return { total, items: page.map(serializeCandidate) };
  }

  async listRootFolders(userId: string, snapshotId: string) {
    await this.assertSnapshotOwned(userId, snapshotId);
    const rows = await this.prisma.cuttingRoomCandidate.groupBy({
      by: ['rootFolderPath'],
      where: { snapshotId },
      _count: { id: true },
      _sum: { sizeBytes: true },
    });
    return rows
      .filter((r) => r.rootFolderPath)
      .map((r) => ({
        rootFolderPath: r.rootFolderPath as string,
        count: r._count.id,
        bytes: Number(r._sum.sizeBytes ?? 0),
      }));
  }

  // ---- Selection -----------------------------------------------------------------

  async autoSelect(params: {
    userId: string;
    snapshotId: string;
    targetBytes: number;
    maxTier?: number;
    minScore?: number;
    rootFolder?: string;
  }) {
    await this.assertSnapshotOwned(params.userId, params.snapshotId);
    if (!Number.isFinite(params.targetBytes) || params.targetBytes <= 0) {
      throw new BadRequestException('targetBytes must be positive');
    }

    const where: Record<string, unknown> = {
      snapshotId: params.snapshotId,
      pruneStatus: 'pending',
    };
    if (params.maxTier) where['tier'] = { lte: params.maxTier };
    if (params.minScore) where['score'] = { gte: params.minScore };
    if (params.rootFolder) where['rootFolderPath'] = params.rootFolder;

    const rows = await this.prisma.cuttingRoomCandidate.findMany({
      where: where as never,
      select: { id: true, score: true, sizeBytes: true },
    });

    // Greedy knapsack by score-per-GB: best "value" deletions first.
    rows.sort((a, b) => {
      const ra = a.score / Math.max(0.05, Number(a.sizeBytes) / 1e9);
      const rb = b.score / Math.max(0.05, Number(b.sizeBytes) / 1e9);
      return rb - ra;
    });

    const chosen: string[] = [];
    let bytes = 0;
    for (const row of rows) {
      const size = Number(row.sizeBytes);
      if (bytes + size > params.targetBytes && chosen.length > 0) continue;
      chosen.push(row.id);
      bytes += size;
      if (bytes >= params.targetBytes) break;
    }

    await this.prisma.cuttingRoomCandidate.updateMany({
      where: { snapshotId: params.snapshotId },
      data: { selected: false },
    });
    if (chosen.length > 0) {
      await this.prisma.cuttingRoomCandidate.updateMany({
        where: { id: { in: chosen } },
        data: { selected: true },
      });
    }
    await this.prisma.cuttingRoomSnapshot.update({
      where: { id: params.snapshotId },
      data: {
        targetBytes: BigInt(Math.round(params.targetBytes)),
        selectedCount: chosen.length,
        selectedBytes: BigInt(Math.round(bytes)),
      },
    });
    return { selectedCount: chosen.length, selectedBytes: bytes };
  }

  async patchSelection(params: {
    userId: string;
    snapshotId: string;
    ids?: string[];
    all?: boolean;
    selected: boolean;
    maxTier?: number;
    minScore?: number;
    rootFolder?: string;
  }) {
    await this.assertSnapshotOwned(params.userId, params.snapshotId);

    if (params.all) {
      const where: Record<string, unknown> = {
        snapshotId: params.snapshotId,
        pruneStatus: 'pending',
      };
      if (params.maxTier) where['tier'] = { lte: params.maxTier };
      if (params.minScore) where['score'] = { gte: params.minScore };
      if (params.rootFolder) where['rootFolderPath'] = params.rootFolder;
      await this.prisma.cuttingRoomCandidate.updateMany({
        where: where as never,
        data: { selected: params.selected },
      });
    } else if (params.ids && params.ids.length > 0) {
      await this.prisma.cuttingRoomCandidate.updateMany({
        where: { snapshotId: params.snapshotId, id: { in: params.ids } },
        data: { selected: params.selected },
      });
    }

    const selected = await this.prisma.cuttingRoomCandidate.aggregate({
      where: {
        snapshotId: params.snapshotId,
        selected: true,
        pruneStatus: 'pending',
      },
      _count: { id: true },
      _sum: { sizeBytes: true },
    });
    const selectedCount = selected._count.id;
    const selectedBytes = Number(selected._sum.sizeBytes ?? 0);
    await this.prisma.cuttingRoomSnapshot.update({
      where: { id: params.snapshotId },
      data: {
        selectedCount,
        selectedBytes: BigInt(Math.round(selectedBytes)),
      },
    });
    return { selectedCount, selectedBytes };
  }

  // ---- Duplicates ------------------------------------------------------------------

  /** Movies with multiple versions across the user's movie libraries. */
  async listDuplicates(userId: string, sectionKey?: string | null) {
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const baseUrl =
      pickString(settings, 'plex.baseUrl') ?? pickString(settings, 'plex.url');
    const token =
      pickString(secrets, 'plex.token') ?? pickString(secrets, 'plexToken');
    if (!baseUrl || !token) {
      throw new BadRequestException('Plex is not configured');
    }
    const sections = await this.plexServer.getSections({ baseUrl, token });
    const movieSections = sections.filter(
      (s) =>
        (s.type ?? '').toLowerCase() === 'movie' &&
        (!sectionKey || s.key === sectionKey),
    );
    const groups = [];
    for (const section of movieSections) {
      const items = await this.plexServer.listDuplicateMovies({
        baseUrl,
        token,
        librarySectionKey: section.key,
      });
      groups.push(...items.map((g) => ({ ...g, sectionTitle: section.title })));
    }
    groups.sort((a, b) => b.wasteBytes - a.wasteBytes);
    return {
      total: groups.length,
      wasteBytes: groups.reduce((sum, g) => sum + g.wasteBytes, 0),
      groups,
    };
  }

  // ---- Large files -----------------------------------------------------------------

  /** Movies and episodes whose files exceed the size threshold. */
  async listLargeFiles(
    userId: string,
    thresholdBytes: number,
    opts?: {
      mediaType?: 'movie' | 'show' | 'both';
      sectionKeys?: string[];
      instanceIds?: string[];
    },
  ) {
    const mediaType = opts?.mediaType ?? 'both';
    const sectionKeys = (opts?.sectionKeys ?? []).filter((k) => k.length > 0);
    const instanceIds = (opts?.instanceIds ?? []).filter((k) => k.length > 0);
    const warnings: string[] = [];
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const baseUrl =
      pickString(settings, 'plex.baseUrl') ?? pickString(settings, 'plex.url');
    const token =
      pickString(secrets, 'plex.token') ?? pickString(secrets, 'plexToken');

    // When specific Plex sections are chosen, movie paths (which live in the
    // *arr namespace) are matched against those sections' folder locations.
    let movieLocationFilter: {
      mappings: PathPrefixMapping[];
      locations: string[];
    } | null = null;
    if (mediaType !== 'show' && sectionKeys.length > 0 && baseUrl && token) {
      try {
        const sectionInfo = await this.plexServer.getSectionLocations({
          baseUrl,
          token,
        });
        const selected = sectionKeys
          .map((key) => sectionInfo.get(key))
          .filter(
            (info): info is PlexSectionWithLocations =>
              Boolean(info) &&
              (info as PlexSectionWithLocations).type === 'movie',
          );
        const movieSectionCount = Array.from(sectionInfo.values()).filter(
          (info) => info.type === 'movie',
        ).length;
        // Only filter when the user deselected some movie section; with all
        // sections selected (or locations unavailable) every movie qualifies.
        if (selected.length > 0 && selected.length < movieSectionCount) {
          movieLocationFilter = {
            mappings: [],
            locations: selected.flatMap((info) => info.locations),
          };
        }
      } catch {
        movieLocationFilter = null;
        warnings.push(
          'Plex library folders could not be checked — movies from all libraries are listed.',
        );
      }
    }

    const items: LargeFileListItem[] = [];

    // Movies straight from Radarr (movieFile.size is authoritative).
    const instances =
      mediaType === 'show'
        ? []
        : await this.arrInstances.list(userId, 'radarr');
    for (const instance of instances) {
      if (instanceIds.length > 0 && !instanceIds.includes(instance.id)) {
        continue;
      }
      try {
        const resolved = await this.arrInstances.resolveInstance(
          userId,
          'radarr',
          instance.id,
          { requireConfigured: false },
        );
        if (!resolved?.baseUrl || !resolved?.apiKey) continue;
        const movies = await this.radarr.listMovies({
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
        });
        if (movieLocationFilter && movieLocationFilter.mappings.length === 0) {
          const arrRoots = Array.from(
            new Set(
              movies
                .map((m) =>
                  typeof m.rootFolderPath === 'string' ? m.rootFolderPath : '',
                )
                .filter((value) => value.length > 0),
            ),
          );
          movieLocationFilter.mappings = derivePathMap(
            arrRoots,
            movieLocationFilter.locations,
          );
        }
        for (const movie of movies) {
          const size =
            typeof movie.movieFile?.size === 'number'
              ? movie.movieFile.size
              : 0;
          if (size < thresholdBytes) continue;
          if (movieLocationFilter) {
            const rawPath =
              typeof movie.movieFile?.path === 'string'
                ? movie.movieFile.path
                : (movie.path ?? null);
            if (rawPath) {
              const plexPath = translatePath(
                rawPath,
                movieLocationFilter.mappings,
              );
              const inSelected = movieLocationFilter.locations.some(
                (loc) => plexPath === loc || plexPath.startsWith(`${loc}/`),
              );
              if (!inSelected) continue;
            }
          }
          items.push({
            kind: 'movie',
            title: movie.title ?? '(untitled)',
            showTitle: null,
            seasonNumber: null,
            episodeNumber: null,
            sizeBytes: size,
            path:
              typeof movie.movieFile?.path === 'string'
                ? movie.movieFile.path
                : (movie.path ?? null),
            arrInstanceId: instance.id,
            movieId: movie.id,
            plexRatingKey: null,
          });
        }
      } catch {
        warnings.push(
          `Radarr instance "${instance.name ?? instance.id}" could not be scanned — its movies are not listed.`,
        );
      }
    }

    // Episodes from Plex (sizes live on the parts; Sonarr resolution happens
    // at execution time).
    if ((!baseUrl || !token) && mediaType !== 'movie') {
      warnings.push('Plex is not configured — episodes were not scanned.');
    }
    if (baseUrl && token && mediaType !== 'movie') {
      const sections = await this.plexServer.getSections({ baseUrl, token });
      for (const section of sections) {
        if ((section.type ?? '').toLowerCase() !== 'show') continue;
        if (sectionKeys.length > 0 && !sectionKeys.includes(section.key)) {
          continue;
        }
        try {
          const episodes = await this.plexServer.listLargeEpisodes({
            baseUrl,
            token,
            librarySectionKey: section.key,
            thresholdBytes,
          });
          for (const episode of episodes) {
            items.push({
              kind: 'episode',
              title: episode.title ?? '(untitled)',
              showTitle: episode.showTitle,
              seasonNumber: episode.seasonNumber,
              episodeNumber: episode.episodeNumber,
              sizeBytes: episode.sizeBytes,
              path: episode.file,
              arrInstanceId: null,
              movieId: null,
              plexRatingKey: episode.ratingKey,
            });
          }
        } catch {
          warnings.push(
            `Plex library "${section.title ?? section.key}" could not be scanned — its episodes are not listed.`,
          );
        }
      }
    }

    const deduped = dedupeEpisodesByFile(items);
    deduped.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return {
      total: deduped.length,
      totalBytes: deduped.reduce((sum, i) => sum + i.sizeBytes, 0),
      items: deduped,
      warnings,
    };
  }

  // ---- Prune gate -----------------------------------------------------------------

  async validatePruneRequest(params: {
    userId: string;
    snapshotId: string;
    confirmation: string;
  }) {
    const snapshot = await this.prisma.cuttingRoomSnapshot.findUnique({
      where: { id: params.snapshotId },
    });
    if (!snapshot || snapshot.userId !== params.userId) {
      throw new NotFoundException('Snapshot not found');
    }
    if (!['READY', 'PARTIAL'].includes(snapshot.status)) {
      throw new ConflictException(
        `Snapshot is not prunable (status=${snapshot.status})`,
      );
    }
    const selected = await this.prisma.cuttingRoomCandidate.aggregate({
      where: {
        snapshotId: params.snapshotId,
        selected: true,
        pruneStatus: 'pending',
      },
      _count: { id: true },
      _sum: { sizeBytes: true },
    });
    const selectedCount = selected._count.id;
    if (selectedCount === 0) {
      throw new BadRequestException('Nothing is selected');
    }
    const confirmation = params.confirmation.trim();
    if (
      confirmation !== String(selectedCount) &&
      confirmation.toUpperCase() !== 'PRUNE'
    ) {
      throw new BadRequestException(
        `Confirmation mismatch: type the selected item count (${selectedCount}) or "PRUNE"`,
      );
    }
    const rules = await this.rules.getRules(params.userId);
    const selectedBytes = Number(selected._sum.sizeBytes ?? 0);
    if (selectedCount > rules.maxItemsPerRun) {
      throw new BadRequestException(
        `Selection (${selectedCount}) exceeds the per-run cap of ${rules.maxItemsPerRun} items`,
      );
    }
    if (selectedBytes > rules.maxBytesPerRun) {
      throw new BadRequestException(
        `Selection (${(selectedBytes / 1e12).toFixed(2)} TB) exceeds the per-run cap of ${(rules.maxBytesPerRun / 1e12).toFixed(1)} TB`,
      );
    }
    return { selectedCount, selectedBytes };
  }

  async requestStop(userId: string, snapshotId: string) {
    await this.assertSnapshotOwned(userId, snapshotId);
    await this.prisma.cuttingRoomSnapshot.update({
      where: { id: snapshotId },
      data: { stopRequested: true },
    });
    return { ok: true };
  }

  // ---- Pruned history / restore ------------------------------------------------

  async listPrunes(params: {
    userId: string;
    take: number;
    skip: number;
    mediaType?: string;
    restored?: boolean;
    search?: string;
  }) {
    const where: Record<string, unknown> = { userId: params.userId };
    if (params.mediaType) where['mediaType'] = params.mediaType;
    if (params.restored === true) where['restoredAt'] = { not: null };
    if (params.restored === false) where['restoredAt'] = null;
    if (params.search) where['title'] = { contains: params.search };

    const take = Math.min(200, Math.max(1, params.take));
    const [total, rows, allTime] = await Promise.all([
      this.prisma.pruneRecord.count({ where: where as never }),
      this.prisma.pruneRecord.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        skip: Math.max(0, params.skip),
        take,
      }),
      // All-time reclaim stat ignores the list filters on purpose: it is a
      // lifetime total for this user, not a view of the current page.
      this.prisma.pruneRecord.aggregate({
        where: { userId: params.userId, restoredAt: null },
        _sum: { sizeBytes: true },
        _count: { _all: true },
      }),
    ]);
    return {
      total,
      allTime: {
        count: allTime._count._all,
        bytes: Number(allTime._sum.sizeBytes ?? 0),
      },
      items: rows.map((row) => ({
        id: row.id,
        source: row.source,
        mediaType: row.mediaType,
        title: row.title,
        year: row.year,
        sizeBytes: Number(row.sizeBytes),
        tmdbId: row.tmdbId,
        tvdbId: row.tvdbId,
        arrInstanceId: row.arrInstanceId,
        arrId: row.arrId,
        action: row.action,
        tagApplied: row.tagApplied,
        restoredAt: row.restoredAt ? row.restoredAt.toISOString() : null,
        restoreNote: row.restoreNote,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * One-click undo: re-monitor the arr entry, remove the pruned tag, and
   * trigger a search so the item re-downloads automatically.
   */
  async restorePrune(userId: string, pruneId: string) {
    const record = await this.prisma.pruneRecord.findUnique({
      where: { id: pruneId },
    });
    if (!record || record.userId !== userId) {
      throw new NotFoundException('Prune record not found');
    }
    if (record.restoredAt) {
      throw new ConflictException('Already restored');
    }
    if (record.action === 'plex_only_delete' || !record.arrId) {
      throw new BadRequestException(
        'This item was not tracked by Radarr/Sonarr — re-add it manually',
      );
    }
    if (record.action === 'entry_removed') {
      throw new BadRequestException(
        'The Radarr/Sonarr entry was removed — re-add it manually to re-download',
      );
    }

    const type = record.mediaType === 'movie' ? 'radarr' : 'sonarr';
    const resolved = await this.arrInstances.resolveInstance(
      userId,
      type,
      record.arrInstanceId,
      { requireConfigured: false },
    );
    if (!resolved?.baseUrl || !resolved?.apiKey) {
      throw new BadRequestException(`${type} is not configured`);
    }
    const creds = { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey };
    const rules = await this.rules.getRules(userId);

    // Find the prune tag id (may not exist anymore — that's fine).
    let tagId: number | null = null;
    try {
      const client = type === 'radarr' ? this.radarr : this.sonarr;
      const tags = await client.listTags(creds);
      tagId =
        tags.find((t) => t.label.toLowerCase() === rules.pruneTagLabel)?.id ??
        null;
    } catch {
      tagId = null;
    }

    if (type === 'radarr') {
      await this.radarr.updateMoviesEditor({
        ...creds,
        movieIds: [record.arrId],
        monitored: true,
        ...(tagId ? { tags: [tagId], applyTags: 'remove' as const } : {}),
      });
      await this.radarr.searchMovies({ ...creds, movieIds: [record.arrId] });
    } else {
      await this.sonarr.updateSeriesEditor({
        ...creds,
        seriesIds: [record.arrId],
        monitored: true,
        ...(tagId ? { tags: [tagId], applyTags: 'remove' as const } : {}),
      });
      await this.sonarr.searchSeries({ ...creds, seriesId: record.arrId });
    }

    await this.prisma.pruneRecord.update({
      where: { id: pruneId },
      data: {
        restoredAt: new Date(),
        restoreNote: 're-monitored and searching',
      },
    });
    return { ok: true };
  }

  private async assertSnapshotOwned(userId: string, snapshotId: string) {
    const snapshot = await this.prisma.cuttingRoomSnapshot.findUnique({
      where: { id: snapshotId },
      select: { userId: true },
    });
    if (!snapshot || snapshot.userId !== userId) {
      throw new NotFoundException('Snapshot not found');
    }
  }
}
