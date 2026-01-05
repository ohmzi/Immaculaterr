import { Injectable } from '@nestjs/common';
import {
  PlexServerService,
  type PlexMetadataDetails,
} from './plex-server.service';

export type PlexDeletePreference =
  | 'smallest_file'
  | 'largest_file'
  | 'newest'
  | 'oldest';

export type PlexDuplicateCopy = {
  mediaId: string | null;
  videoResolution: string | null;
  partId: string | null;
  partKey: string | null;
  file: string | null;
  size: number | null;
  preserved: boolean;
};

export type PlexDuplicateCleanupResult = {
  dryRun: boolean;
  ratingKey: string;
  title: string;
  type: string | null;
  copies: number;
  kept: PlexDuplicateCopy | null;
  deleted: number;
  wouldDelete: number;
  failures: number;
  warnings: string[];
  deletions: Array<
    PlexDuplicateCopy & {
      deleted: boolean;
      error?: string;
    }
  >;
  metadata: {
    tmdbIds: number[];
    tvdbIds: number[];
    year: number | null;
    parentIndex: number | null;
    index: number | null;
  };
};

function resolutionPriority(resolution: string | null): number {
  // Mirror Python sonarr_duplicate_cleaner.get_resolution_priority
  if (!resolution) return 1;
  const r = String(resolution).toLowerCase().trim();
  if (r.includes('4k') || r.includes('2160')) return 4;
  if (r.includes('1080')) return 3;
  if (r.includes('720')) return 2;
  if (r.includes('480')) return 1;
  return 1;
}

function sortBySizeAsc(a: PlexDuplicateCopy, b: PlexDuplicateCopy) {
  const sa = typeof a.size === 'number' ? a.size : Number.POSITIVE_INFINITY;
  const sb = typeof b.size === 'number' ? b.size : Number.POSITIVE_INFINITY;
  return sa - sb;
}

function sortBySizeDesc(a: PlexDuplicateCopy, b: PlexDuplicateCopy) {
  const sa = typeof a.size === 'number' ? a.size : Number.NEGATIVE_INFINITY;
  const sb = typeof b.size === 'number' ? b.size : Number.NEGATIVE_INFINITY;
  return sb - sa;
}

function buildCopies(
  meta: PlexMetadataDetails,
  preserveQualityTerms: string[],
): PlexDuplicateCopy[] {
  const terms = (preserveQualityTerms ?? [])
    .map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
    .filter(Boolean);

  const copies: PlexDuplicateCopy[] = [];

  for (const m of meta.media ?? []) {
    for (const p of m.parts ?? []) {
      const target = `${m.videoResolution ?? ''} ${p.file ?? ''}`.toLowerCase();
      const preserved =
        terms.length > 0 ? terms.some((t) => target.includes(t)) : false;

      copies.push({
        mediaId: m.id,
        videoResolution: m.videoResolution,
        partId: p.id,
        partKey: p.key,
        file: p.file,
        size: p.size,
        preserved,
      });
    }
  }

  return copies;
}

@Injectable()
export class PlexDuplicatesService {
  constructor(private readonly plex: PlexServerService) {}

  /**
   * Movie duplicate cleanup:
   * - Uses deletePreference + preserveQualityTerms (mirrors python movie duplicate cleaner intent)
   * - Deletes until only one copy remains (or multiple remain if all are preserved)
   */
  async cleanupMovieDuplicates(params: {
    baseUrl: string;
    token: string;
    ratingKey: string;
    dryRun: boolean;
    deletePreference: PlexDeletePreference;
    preserveQualityTerms: string[];
  }): Promise<PlexDuplicateCleanupResult> {
    const {
      baseUrl,
      token,
      ratingKey,
      dryRun,
      deletePreference,
      preserveQualityTerms,
    } = params;

    const meta =
      await this.plex.getMetadataDetails({ baseUrl, token, ratingKey });
    if (!meta) {
      return {
        dryRun,
        ratingKey,
        title: '',
        type: null,
        copies: 0,
        kept: null,
        deleted: 0,
        wouldDelete: 0,
        failures: 0,
        warnings: ['plex: metadata not found'],
        deletions: [],
        metadata: {
          tmdbIds: [],
          tvdbIds: [],
          year: null,
          parentIndex: null,
          index: null,
        },
      };
    }

    const warnings: string[] = [];
    const copies = buildCopies(meta, preserveQualityTerms);
    if (copies.length <= 1) {
      return {
        dryRun,
        ratingKey: meta.ratingKey,
        title: meta.title,
        type: meta.type,
        copies: copies.length,
        kept: copies[0] ?? null,
        deleted: 0,
        wouldDelete: 0,
        failures: 0,
        warnings,
        deletions: [],
        metadata: {
          tmdbIds: meta.tmdbIds,
          tvdbIds: meta.tvdbIds,
          year: meta.year,
          parentIndex: meta.parentIndex,
          index: meta.index,
        },
      };
    }

    // Respect preserve terms:
    // - If at least one preserved copy exists, keep a preserved copy and delete the rest (including other preserved copies).
    // - If none are preserved, keep the best copy according to deletePreference.
    const preservedCopies = copies.filter((c) => c.preserved);

    // deletePreference mirrors the Python config naming ("which copy to delete").
    // For per-item versions we lack per-copy timestamps, so newest/oldest fall back to file size.
    let pref = deletePreference;
    if (pref === 'newest' || pref === 'oldest') {
      warnings.push(
        `plex: deletePreference=${pref} not supported for per-item version cleanup; falling back to smallest_file`,
      );
      pref = 'smallest_file';
    }

    // Choose the "best to keep" ordering (inverse of deletePreference).
    // - delete smallest -> keep largest (desc)
    // - delete largest  -> keep smallest (asc)
    const keepSort = pref === 'largest_file' ? sortBySizeAsc : sortBySizeDesc;

    const keepPool = preservedCopies.length > 0 ? preservedCopies : copies;
    const orderedKeep = keepPool.slice().sort(keepSort);
    const kept = orderedKeep[0] ?? null;

    const keptKey = kept?.partKey ?? kept?.partId ?? null;
    const toDelete = (() => {
      if (!kept || !keptKey) {
        warnings.push(
          'plex: unable to identify a stable kept copy (missing partKey/partId); skipping deletion for safety',
        );
        return [];
      }
      return copies.filter(
        (c) => (c.partKey ?? c.partId ?? null) !== keptKey,
      );
    })();

    let deleted = 0;
    let wouldDelete = 0;
    let failures = 0;
    const deletions: PlexDuplicateCleanupResult['deletions'] = [];

    for (const copy of toDelete) {
      if (!copy.partKey) {
        failures += 1;
        deletions.push({
          ...copy,
          deleted: false,
          error: 'missing partKey',
        });
        continue;
      }

      if (dryRun) {
        wouldDelete += 1;
        deletions.push({ ...copy, deleted: false });
        continue;
      }

      try {
        await this.plex.deletePartByKey({
          baseUrl,
          token,
          partKey: copy.partKey,
        });
        deleted += 1;
        deletions.push({ ...copy, deleted: true });
      } catch (err) {
        failures += 1;
        deletions.push({
          ...copy,
          deleted: false,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    return {
      dryRun,
      ratingKey: meta.ratingKey,
      title: meta.title,
      type: meta.type,
      copies: copies.length,
      kept,
      deleted,
      wouldDelete,
      failures,
      warnings,
      deletions,
      metadata: {
        tmdbIds: meta.tmdbIds,
        tvdbIds: meta.tvdbIds,
        year: meta.year,
        parentIndex: meta.parentIndex,
        index: meta.index,
      },
    };
  }

  /**
   * Episode duplicate cleanup:
   * - Keeps best resolution (4k > 1080 > 720 > 480 > unknown), tie-break by size
   * - Deletes all other copies (mirrors python sonarr_duplicate_cleaner)
   */
  async cleanupEpisodeDuplicates(params: {
    baseUrl: string;
    token: string;
    ratingKey: string;
    dryRun: boolean;
  }): Promise<PlexDuplicateCleanupResult> {
    const { baseUrl, token, ratingKey, dryRun } = params;

    const meta =
      await this.plex.getMetadataDetails({ baseUrl, token, ratingKey });
    if (!meta) {
      return {
        dryRun,
        ratingKey,
        title: '',
        type: null,
        copies: 0,
        kept: null,
        deleted: 0,
        wouldDelete: 0,
        failures: 0,
        warnings: ['plex: metadata not found'],
        deletions: [],
        metadata: {
          tmdbIds: [],
          tvdbIds: [],
          year: null,
          parentIndex: null,
          index: null,
        },
      };
    }

    const copies = buildCopies(meta, []);
    const warnings: string[] = [];

    if (copies.length <= 1) {
      return {
        dryRun,
        ratingKey: meta.ratingKey,
        title: meta.title,
        type: meta.type,
        copies: copies.length,
        kept: copies[0] ?? null,
        deleted: 0,
        wouldDelete: 0,
        failures: 0,
        warnings,
        deletions: [],
        metadata: {
          tmdbIds: meta.tmdbIds,
          tvdbIds: meta.tvdbIds,
          year: meta.year,
          parentIndex: meta.parentIndex,
          index: meta.index,
        },
      };
    }

    const ordered = copies
      .slice()
      .sort((a, b) => {
        const pa = resolutionPriority(a.videoResolution);
        const pb = resolutionPriority(b.videoResolution);
        if (pa !== pb) return pa - pb; // worst first
        return sortBySizeAsc(a, b);
      });

    const toDelete = ordered.slice(0, -1);
    const kept = ordered.at(-1) ?? null;

    let deleted = 0;
    let wouldDelete = 0;
    let failures = 0;
    const deletions: PlexDuplicateCleanupResult['deletions'] = [];

    for (const copy of toDelete) {
      if (!copy.partKey) {
        failures += 1;
        deletions.push({
          ...copy,
          deleted: false,
          error: 'missing partKey',
        });
        continue;
      }

      if (dryRun) {
        wouldDelete += 1;
        deletions.push({ ...copy, deleted: false });
        continue;
      }

      try {
        await this.plex.deletePartByKey({ baseUrl, token, partKey: copy.partKey });
        deleted += 1;
        deletions.push({ ...copy, deleted: true });
      } catch (err) {
        failures += 1;
        deletions.push({
          ...copy,
          deleted: false,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    return {
      dryRun,
      ratingKey: meta.ratingKey,
      title: meta.title,
      type: meta.type,
      copies: copies.length,
      kept,
      deleted,
      wouldDelete,
      failures,
      warnings,
      deletions,
      metadata: {
        tmdbIds: meta.tmdbIds,
        tvdbIds: meta.tvdbIds,
        year: meta.year,
        parentIndex: meta.parentIndex,
        index: meta.index,
      },
    };
  }
}


