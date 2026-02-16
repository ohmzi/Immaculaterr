import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from '../immaculate-taste-collection/immaculate-taste-show-collection.service';
import {
  buildUserCollectionHubOrder,
  buildUserCollectionName,
  CURATED_MOVIE_COLLECTION_HUB_ORDER,
  CURATED_TV_COLLECTION_HUB_ORDER,
} from '../plex/plex-collections.utils';
import { PlexCuratedCollectionsService } from '../plex/plex-curated-collections.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexService } from '../plex/plex.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
import type { JobReportTask, JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';
import type {
  JobContext,
  JobRunResult,
  JsonObject,
  JsonValue,
} from './jobs.types';

export const COLLECTION_RESYNC_UPGRADE_JOB_ID = 'collectionResyncUpgrade';
export const COLLECTION_RESYNC_UPGRADE_VERSION = 'v1_5_3';
export const COLLECTION_RESYNC_UPGRADE_STATE_KEY = `upgrade.collectionResync.${COLLECTION_RESYNC_UPGRADE_VERSION}.state`;
export const COLLECTION_RESYNC_UPGRADE_LOCK_UNTIL_KEY = `upgrade.collectionResync.${COLLECTION_RESYNC_UPGRADE_VERSION}.lockUntil`;
export const COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY = `upgrade.collectionResync.${COLLECTION_RESYNC_UPGRADE_VERSION}.completedAt`;

const RESTART_GUIDANCE =
  'Restart Immaculaterr to resume migration from checkpoint.';
const IMMACULATE_BASE_COLLECTION = 'Inspired by your Immaculate Taste';
const LOCK_TTL_MS = 10 * 60_000;
const ITEM_RETRY_MAX = 3;
const ITEM_PACING_MS = 250;

type UpgradeMediaType = 'movie' | 'tv';
type UpgradeSource = 'plex' | 'immaculaterr';
type UpgradePhase =
  | 'pending'
  | 'captured'
  | 'deleted'
  | 'recreated'
  | 'verified'
  | 'done'
  | 'failed';
type UpgradeTaskId =
  | 'capture_existing_state'
  | 'delete_all_plex_collections'
  | 'recreate_collections_sequentially'
  | 'verification_and_finalize';
type UpgradeTaskStatus = 'success' | 'skipped' | 'failed';

type CollectionResyncQueueSourceTable =
  | 'ImmaculateTasteMovieLibrary'
  | 'ImmaculateTasteShowLibrary'
  | 'WatchedMovieRecommendationLibrary'
  | 'WatchedShowRecommendationLibrary';

export type CollectionResyncQueueItem = {
  key: string;
  plexUserId: string;
  mediaType: UpgradeMediaType;
  librarySectionKey: string;
  collectionBaseName: string;
  targetCollectionName: string;
  sourceTable: CollectionResyncQueueSourceTable;
  rowCount: number;
  activeRowCount: number;
  pinTarget: 'admin' | 'friends';
};

type UpgradeDeleteQueueItem = {
  deleteKey: string;
  librarySectionKey: string;
  libraryTitle: string;
  libraryType: string;
  collectionRatingKey: string;
  collectionTitle: string;
};

type UpgradeItemProgress = {
  phase: UpgradePhase;
  source: UpgradeSource;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
  capturedAt: string | null;
  deletedAt: string | null;
  recreatedAt: string | null;
  verifiedAt: string | null;
  doneAt: string | null;
};

type UpgradeFailure = {
  source: UpgradeSource;
  operation: string;
  itemKey: string;
  message: string;
  restartGuidance: string;
  at: string;
};

type UpgradeState = {
  version: 1;
  startedAt: string;
  updatedAt: string;
  adminUserId: string;
  preRefreshUserTitles: Record<string, string>;
  queue: CollectionResyncQueueItem[];
  itemProgress: Record<string, UpgradeItemProgress>;
  deleteQueue: UpgradeDeleteQueueItem[];
  deleteProgress: Record<string, UpgradeItemProgress>;
  deletedCollections: Array<{
    deleteKey: string;
    librarySectionKey: string;
    collectionRatingKey: string;
    collectionTitle: string;
    deletedAt: string;
  }>;
  snapshot: JsonObject | null;
  failures: UpgradeFailure[];
  phases: {
    queueBuiltAt: string | null;
    captureCompletedAt: string | null;
    deleteCompletedAt: string | null;
    recreateCompletedAt: string | null;
    finalizedAt: string | null;
  };
};

type TaskState = {
  id: UpgradeTaskId;
  title: string;
  status: UpgradeTaskStatus;
  rows: ReturnType<typeof metricRow>[];
  facts: Array<{ label: string; value: JsonValue }>;
  issues: ReturnType<typeof issue>[];
};

type RefreshTitlesResult = {
  machineIdentifier: string;
  adminPlexUser: PlexUserRecord;
  plexUserLookup: Map<string, PlexUserRecord>;
  usersRefreshed: number;
  sharedUsersDiscovered: number;
};

type SuggestionCounts = {
  immaculateMovieRows: number;
  immaculateShowRows: number;
  watchedMovieRows: number;
  watchedShowRows: number;
};

type PlexUserRecord = {
  id: string;
  plexAccountId: number | null;
  plexAccountTitle: string;
  isAdmin: boolean;
};

class UpgradeOperationError extends Error {
  constructor(
    readonly source: UpgradeSource,
    readonly operation: string,
    readonly itemKey: string,
    message: string,
  ) {
    super(message);
    this.name = 'UpgradeOperationError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function pickString(obj: Record<string, unknown>, path: string): string {
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function pickNumber(obj: Record<string, unknown>, path: string): number | null {
  const v = pick(obj, path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(baseUrl);
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function toFiniteInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.max(0, Math.trunc(value));
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return fallback;
}

function isNotFoundError(err: unknown): boolean {
  const msg = safeErrorMessage(err).toLowerCase();
  return msg.includes('http 404') || msg.includes('not found');
}

function extractPlexUserTitleFromCollectionName(name: string): string | null {
  const match = String(name ?? '')
    .trim()
    .match(/\(([^)]+)\)\s*$/);
  if (!match?.[1]) return null;
  const title = match[1].trim();
  return title || null;
}

function asJsonObject(value: unknown): JsonObject | null {
  return isPlainObject(value) ? (value as JsonObject) : null;
}

function createProgress(
  source: UpgradeSource,
  phase: UpgradePhase = 'pending',
): UpgradeItemProgress {
  const stamp = nowIso();
  return {
    phase,
    source,
    attempts: 0,
    lastError: null,
    updatedAt: stamp,
    capturedAt: phase === 'captured' ? stamp : null,
    deletedAt: phase === 'deleted' ? stamp : null,
    recreatedAt: phase === 'recreated' ? stamp : null,
    verifiedAt: phase === 'verified' ? stamp : null,
    doneAt: phase === 'done' ? stamp : null,
  };
}

function markProgressPhase(
  progress: UpgradeItemProgress,
  phase: UpgradePhase,
): UpgradeItemProgress {
  const stamp = nowIso();
  progress.phase = phase;
  progress.updatedAt = stamp;
  if (phase === 'captured') progress.capturedAt = stamp;
  if (phase === 'deleted') progress.deletedAt = stamp;
  if (phase === 'recreated') progress.recreatedAt = stamp;
  if (phase === 'verified') progress.verifiedAt = stamp;
  if (phase === 'done') progress.doneAt = stamp;
  if (phase !== 'failed') progress.lastError = null;
  return progress;
}

export function buildCollectionResyncQueueItemKey(params: {
  plexUserId: string;
  mediaType: UpgradeMediaType;
  librarySectionKey: string;
  collectionBaseName: string;
}): string {
  return [
    params.plexUserId.trim(),
    params.mediaType,
    params.librarySectionKey.trim(),
    params.collectionBaseName.trim(),
  ].join('|');
}

function sortQueueItems(
  items: CollectionResyncQueueItem[],
): CollectionResyncQueueItem[] {
  return items.slice().sort((a, b) => {
    if (a.plexUserId !== b.plexUserId)
      return a.plexUserId.localeCompare(b.plexUserId);
    if (a.mediaType !== b.mediaType)
      return a.mediaType.localeCompare(b.mediaType);
    if (a.librarySectionKey !== b.librarySectionKey)
      return a.librarySectionKey.localeCompare(b.librarySectionKey);
    if (a.collectionBaseName !== b.collectionBaseName)
      return a.collectionBaseName.localeCompare(b.collectionBaseName);
    return a.key.localeCompare(b.key);
  });
}

export function getPendingQueueItemsInOrder(params: {
  queue: CollectionResyncQueueItem[];
  itemProgress: Record<string, { phase: UpgradePhase } | undefined>;
}): CollectionResyncQueueItem[] {
  return params.queue.filter(
    (item) => params.itemProgress[item.key]?.phase !== 'done',
  );
}

function taskTitles(): Record<UpgradeTaskId, string> {
  return {
    capture_existing_state: 'Capture Existing State',
    delete_all_plex_collections: 'Delete All Plex Collections',
    recreate_collections_sequentially: 'Recreate Collections Sequentially',
    verification_and_finalize: 'Verification and Finalize',
  };
}

function orderedTaskIds(): UpgradeTaskId[] {
  return [
    'capture_existing_state',
    'delete_all_plex_collections',
    'recreate_collections_sequentially',
    'verification_and_finalize',
  ];
}

function buildInitialTaskState(): Record<UpgradeTaskId, TaskState> {
  const titles = taskTitles();
  return {
    capture_existing_state: {
      id: 'capture_existing_state',
      title: titles.capture_existing_state,
      status: 'skipped',
      rows: [],
      facts: [],
      issues: [],
    },
    delete_all_plex_collections: {
      id: 'delete_all_plex_collections',
      title: titles.delete_all_plex_collections,
      status: 'skipped',
      rows: [],
      facts: [],
      issues: [],
    },
    recreate_collections_sequentially: {
      id: 'recreate_collections_sequentially',
      title: titles.recreate_collections_sequentially,
      status: 'skipped',
      rows: [],
      facts: [],
      issues: [],
    },
    verification_and_finalize: {
      id: 'verification_and_finalize',
      title: titles.verification_and_finalize,
      status: 'skipped',
      rows: [],
      facts: [],
      issues: [],
    },
  };
}

function toTaskArray(map: Record<UpgradeTaskId, TaskState>): JobReportTask[] {
  return orderedTaskIds().map((id) => {
    const task = map[id];
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      ...(task.rows.length ? { rows: task.rows } : {}),
      ...(task.facts.length ? { facts: task.facts } : {}),
      ...(task.issues.length ? { issues: task.issues } : {}),
    };
  });
}

@Injectable()
export class CollectionResyncUpgradeJob {
  private readonly logger = new Logger(CollectionResyncUpgradeJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexService: PlexService,
    private readonly plexUsers: PlexUsersService,
    private readonly plexServer: PlexServerService,
    private readonly plexCurated: PlexCuratedCollectionsService,
    private readonly immaculateMovies: ImmaculateTasteCollectionService,
    private readonly immaculateShows: ImmaculateTasteShowCollectionService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const taskState = buildInitialTaskState();
    const runStartedAt = nowIso();
    const reportIssues: ReturnType<typeof issue>[] = [];
    const raw: Record<string, unknown> = {
      version: COLLECTION_RESYNC_UPGRADE_VERSION,
      stateKey: COLLECTION_RESYNC_UPGRADE_STATE_KEY,
      lockKey: COLLECTION_RESYNC_UPGRADE_LOCK_UNTIL_KEY,
      completedAtKey: COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY,
      restartGuidance: RESTART_GUIDANCE,
      runStartedAt,
    };

    let currentTask: UpgradeTaskId = 'capture_existing_state';
    let state: UpgradeState | null = null;
    let lockAcquired = false;
    let failureRecord: UpgradeFailure | null = null;

    const patchProgress = async (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
    }) => {
      await ctx
        .patchSummary({
          progress: {
            step: params.step,
            message: params.message,
            ...(params.current !== undefined
              ? { current: params.current }
              : {}),
            ...(params.total !== undefined ? { total: params.total } : {}),
            updatedAt: nowIso(),
          },
        })
        .catch(() => undefined);
    };

    try {
      await patchProgress({
        step: 'capture_existing_state',
        message: 'Preparing one-time collection resync upgrade…',
      });

      const completedAt = await this.getSettingValue(
        COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY,
      );
      if (completedAt) {
        taskState.capture_existing_state.status = 'skipped';
        taskState.capture_existing_state.facts.push({
          label: 'Reason',
          value: 'already_completed',
        });
        taskState.capture_existing_state.facts.push({
          label: 'Completed at',
          value: completedAt,
        });
        raw['skipReason'] = 'already_completed';
        raw['completedAt'] = completedAt;

        return {
          summary: this.buildReport({
            ctx,
            headline: 'Collection resync upgrade already completed.',
            taskState,
            issues: reportIssues,
            raw,
          }) as unknown as JsonObject,
        };
      }

      const lock = await this.acquireLock();
      if (!lock.acquired) {
        taskState.capture_existing_state.status = 'skipped';
        taskState.capture_existing_state.facts.push({
          label: 'Reason',
          value: 'lock_active',
        });
        if (lock.lockUntil) {
          taskState.capture_existing_state.facts.push({
            label: 'Lock until',
            value: lock.lockUntil,
          });
        }
        raw['skipReason'] = 'lock_active';
        raw['lockUntil'] = lock.lockUntil;
        return {
          summary: this.buildReport({
            ctx,
            headline: 'Collection resync upgrade is already running.',
            taskState,
            issues: reportIssues,
            raw,
          }) as unknown as JsonObject,
        };
      }
      lockAcquired = true;
      await this.refreshLock();

      const { settings, secrets } =
        await this.settingsService.getInternalSettings(ctx.userId);
      const plexBaseUrlRaw =
        pickString(settings, 'plex.baseUrl') ||
        pickString(settings, 'plex.url');
      const plexToken =
        pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
      if (!plexBaseUrlRaw || !plexToken) {
        throw new UpgradeOperationError(
          'immaculaterr',
          'resolve_plex_settings',
          'config',
          'Plex baseUrl/token is not configured.',
        );
      }
      const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);
      const watchedLimit = Math.max(
        1,
        Math.min(
          200,
          Math.trunc(
            pickNumber(settings, 'recommendations.collectionLimit') ?? 15,
          ),
        ),
      );
      raw['watchedCollectionLimit'] = watchedLimit;

      const appAdmin = await this.prisma.user.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!appAdmin?.id) {
        await this.writeCompletedAt(nowIso());
        taskState.capture_existing_state.status = 'skipped';
        taskState.capture_existing_state.facts.push({
          label: 'Reason',
          value: 'skipped_new_or_empty_instance',
        });
        raw['skipReason'] = 'skipped_new_or_empty_instance';
        return {
          summary: this.buildReport({
            ctx,
            headline: 'Collection resync upgrade skipped (new/empty instance).',
            taskState,
            issues: [
              issue('warn', 'No app admin user exists; migration skipped.'),
            ],
            raw,
          }) as unknown as JsonObject,
        };
      }

      const counts = await this.readSuggestionCounts();
      raw['suggestionRows'] = counts;
      const totalRows =
        counts.immaculateMovieRows +
        counts.immaculateShowRows +
        counts.watchedMovieRows +
        counts.watchedShowRows;
      if (totalRows === 0) {
        await this.writeCompletedAt(nowIso());
        taskState.capture_existing_state.status = 'skipped';
        taskState.capture_existing_state.facts.push({
          label: 'Reason',
          value: 'skipped_new_or_empty_instance',
        });
        raw['skipReason'] = 'skipped_new_or_empty_instance';
        return {
          summary: this.buildReport({
            ctx,
            headline: 'Collection resync upgrade skipped (new/empty instance).',
            taskState,
            issues: [
              issue(
                'warn',
                'No suggestion rows exist yet; migration skipped for this brand-new instance.',
              ),
            ],
            raw,
          }) as unknown as JsonObject,
        };
      }

      state = (await this.loadState()) ?? this.createEmptyState(appAdmin.id);
      if (!state.adminUserId) state.adminUserId = appAdmin.id;

      const refresh = await this.refreshPlexUserTitles({
        ctx,
        state,
        userId: ctx.userId,
        plexBaseUrl,
        plexToken,
      });
      await this.refreshLock();

      raw['machineIdentifier'] = refresh.machineIdentifier;
      raw['sharedUsersDiscovered'] = refresh.sharedUsersDiscovered;
      raw['usersRefreshed'] = refresh.usersRefreshed;

      if (!state.queue.length) {
        state.queue = await this.buildDeterministicQueue({
          plexUserLookup: refresh.plexUserLookup,
          adminPlexUser: refresh.adminPlexUser,
        });
        state.phases.queueBuiltAt = nowIso();
      } else {
        state.queue = this.syncQueueTargetNames({
          queue: state.queue,
          plexUserLookup: refresh.plexUserLookup,
          adminPlexUser: refresh.adminPlexUser,
          fallbackTitles: state.preRefreshUserTitles,
        });
      }
      state.queue = sortQueueItems(state.queue);
      for (const item of state.queue) {
        if (!state.itemProgress[item.key]) {
          state.itemProgress[item.key] = createProgress(
            'immaculaterr',
            'pending',
          );
        }
      }

      await patchProgress({
        step: 'capture_existing_state',
        message: 'Capturing pre-delete state snapshot…',
      });
      const capture = await this.captureSnapshotAndDeleteQueue({
        state,
        plexBaseUrl,
        plexToken,
        suggestionCounts: counts,
      });
      state.snapshot = state.snapshot ?? capture.snapshot;
      if (!state.deleteQueue.length) state.deleteQueue = capture.deleteQueue;
      for (const deleteItem of state.deleteQueue) {
        if (!state.deleteProgress[deleteItem.deleteKey]) {
          state.deleteProgress[deleteItem.deleteKey] = createProgress(
            'plex',
            'captured',
          );
        }
      }
      for (const item of state.queue) {
        const progress =
          state.itemProgress[item.key] ??
          createProgress('immaculaterr', 'pending');
        if (progress.phase === 'pending')
          markProgressPhase(progress, 'captured');
        state.itemProgress[item.key] = progress;
      }
      state.phases.captureCompletedAt =
        state.phases.captureCompletedAt ?? nowIso();
      await this.saveState(state);
      await this.refreshLock();

      taskState.capture_existing_state.status = 'success';
      taskState.capture_existing_state.rows.push(
        metricRow({
          label: 'Queue items',
          start: null,
          changed: null,
          end: state.queue.length,
          unit: 'collections',
        }),
      );
      taskState.capture_existing_state.rows.push(
        metricRow({
          label: 'Collections discovered before delete',
          start: null,
          changed: null,
          end: state.deleteQueue.length,
          unit: 'collections',
        }),
      );
      raw['queueSize'] = state.queue.length;
      raw['deleteQueueSize'] = state.deleteQueue.length;

      currentTask = 'delete_all_plex_collections';
      await patchProgress({
        step: 'delete_all_plex_collections',
        message: 'Deleting all Plex collections across all libraries…',
      });
      const deleteResult = await this.deleteAllCollections({
        ctx,
        state,
        plexBaseUrl,
        plexToken,
      });
      state.phases.deleteCompletedAt =
        state.phases.deleteCompletedAt ?? nowIso();
      await this.saveState(state);
      await this.refreshLock();

      taskState.delete_all_plex_collections.status = 'success';
      taskState.delete_all_plex_collections.rows.push(
        metricRow({
          label: 'Collections deleted',
          start: null,
          changed: null,
          end: deleteResult.deleted,
          unit: 'collections',
        }),
      );
      raw['deleteResult'] = deleteResult;

      currentTask = 'recreate_collections_sequentially';
      await patchProgress({
        step: 'recreate_collections_sequentially',
        message: 'Recreating collections sequentially from database rows…',
      });
      const recreateResult = await this.recreateCollectionsSequentially({
        ctx,
        state,
        plexBaseUrl,
        plexToken,
        machineIdentifier: refresh.machineIdentifier,
        watchedLimit,
      });
      state.phases.recreateCompletedAt = nowIso();
      await this.saveState(state);
      await this.refreshLock();

      taskState.recreate_collections_sequentially.status = 'success';
      taskState.recreate_collections_sequentially.rows.push(
        metricRow({
          label: 'Queue items completed',
          start: null,
          changed: null,
          end: recreateResult.done,
          unit: 'collections',
        }),
      );
      taskState.recreate_collections_sequentially.rows.push(
        metricRow({
          label: 'Queue items recreated',
          start: null,
          changed: null,
          end: recreateResult.recreated,
          unit: 'collections',
        }),
      );
      taskState.recreate_collections_sequentially.rows.push(
        metricRow({
          label: 'Queue items with zero desired rows',
          start: null,
          changed: null,
          end: recreateResult.emptyDesired,
          unit: 'collections',
        }),
      );
      raw['recreateResult'] = recreateResult;

      currentTask = 'verification_and_finalize';
      await patchProgress({
        step: 'verification_and_finalize',
        message: 'Verifying checkpoints and finalizing migration…',
      });
      const finalize = await this.verifyAndFinalize({ state });
      raw['completedAt'] = finalize.completedAt;
      raw['summaryCounts'] = finalize;

      taskState.verification_and_finalize.status = 'success';
      taskState.verification_and_finalize.facts.push({
        label: 'Completed at',
        value: finalize.completedAt,
      });
      taskState.verification_and_finalize.rows.push(
        metricRow({
          label: 'Delete checkpoints done',
          start: null,
          changed: null,
          end: finalize.deleteDone,
          unit: 'collections',
        }),
      );
      taskState.verification_and_finalize.rows.push(
        metricRow({
          label: 'Recreate checkpoints done',
          start: null,
          changed: null,
          end: finalize.recreateDone,
          unit: 'collections',
        }),
      );

      await ctx.info('collectionResyncUpgrade: completed', {
        queueSize: state.queue.length,
        deleteQueueSize: state.deleteQueue.length,
        completedAt: finalize.completedAt,
      });

      return {
        summary: this.buildReport({
          ctx,
          headline: 'Collection resync upgrade complete.',
          taskState,
          issues: reportIssues,
          raw,
        }) as unknown as JsonObject,
      };
    } catch (err) {
      const failure = this.asFailureRecord(err);
      failureRecord = failure;
      if (state) {
        state.failures.push(failure);
        await this.saveState(state).catch(() => undefined);
      }

      taskState[currentTask].status = 'failed';
      taskState[currentTask].issues.push(
        issue(
          'error',
          `${failure.source}:${failure.operation}:${failure.itemKey}: ${failure.message}`,
        ),
      );
      taskState[currentTask].facts.push({
        label: 'Restart',
        value: RESTART_GUIDANCE,
      });
      reportIssues.push(
        issue(
          'error',
          `${failure.source}:${failure.operation}:${failure.itemKey}: ${failure.message}`,
        ),
      );
      reportIssues.push(issue('warn', RESTART_GUIDANCE));
      raw['failure'] = failure;

      await ctx.error('collectionResyncUpgrade: failed', {
        source: failure.source,
        operation: failure.operation,
        itemKey: failure.itemKey,
        error: failure.message,
        restartGuidance: RESTART_GUIDANCE,
      });

      return {
        summary: this.buildReport({
          ctx,
          headline: 'Collection resync upgrade failed.',
          taskState,
          issues: reportIssues,
          raw,
        }) as unknown as JsonObject,
      };
    } finally {
      if (lockAcquired) {
        await this.releaseLock().catch(() => undefined);
      }
      await ctx
        .patchSummary({
          progress: {
            step: failureRecord ? 'failed' : 'done',
            message: failureRecord ? 'Failed.' : 'Completed.',
            updatedAt: nowIso(),
          },
        })
        .catch(() => undefined);
    }
  }

  private buildReport(params: {
    ctx: JobContext;
    headline: string;
    taskState: Record<UpgradeTaskId, TaskState>;
    issues: ReturnType<typeof issue>[];
    raw: Record<string, unknown>;
  }): JobReportV1 {
    return {
      template: 'jobReportV1',
      version: 1,
      jobId: COLLECTION_RESYNC_UPGRADE_JOB_ID,
      dryRun: params.ctx.dryRun,
      trigger: params.ctx.trigger,
      headline: params.headline,
      sections: [],
      tasks: toTaskArray(params.taskState),
      issues: params.issues,
      raw: (asJsonObject(params.raw) ?? {}) as JsonObject,
    };
  }

  private async readSuggestionCounts(): Promise<SuggestionCounts> {
    const [
      immaculateMovieRows,
      immaculateShowRows,
      watchedMovieRows,
      watchedShowRows,
    ] = await Promise.all([
      this.prisma.immaculateTasteMovieLibrary.count(),
      this.prisma.immaculateTasteShowLibrary.count(),
      this.prisma.watchedMovieRecommendationLibrary.count(),
      this.prisma.watchedShowRecommendationLibrary.count(),
    ]);

    return {
      immaculateMovieRows,
      immaculateShowRows,
      watchedMovieRows,
      watchedShowRows,
    };
  }

  private async refreshPlexUserTitles(params: {
    ctx: JobContext;
    state: UpgradeState;
    userId: string;
    plexBaseUrl: string;
    plexToken: string;
  }): Promise<RefreshTitlesResult> {
    const beforeUsers = await this.prisma.plexUser.findMany({
      select: {
        id: true,
        plexAccountTitle: true,
      },
    });
    params.state.preRefreshUserTitles = Object.fromEntries(
      beforeUsers.map((u: { id: string; plexAccountTitle: string }) => [
        u.id,
        u.plexAccountTitle,
      ]),
    );

    const adminPlexUserRaw = await this.plexUsers.ensureAdminPlexUser({
      userId: params.userId,
    });
    const adminPlexUser: PlexUserRecord = {
      id: adminPlexUserRaw.id,
      plexAccountId: adminPlexUserRaw.plexAccountId ?? null,
      plexAccountTitle: adminPlexUserRaw.plexAccountTitle,
      isAdmin: adminPlexUserRaw.isAdmin,
    };
    const machineIdentifier = await this.plexServer.getMachineIdentifier({
      baseUrl: params.plexBaseUrl,
      token: params.plexToken,
    });
    const whoami = await this.plexService.whoami(params.plexToken);
    if (whoami?.id || whoami?.title || whoami?.username) {
      await this.plexUsers.getOrCreateByPlexAccount({
        plexAccountId: toFiniteInt(whoami.id, 0) || null,
        plexAccountTitle:
          String(whoami.title ?? '').trim() ||
          String(whoami.username ?? '').trim() ||
          null,
      });
    }

    const sharedUsers = await this.plexService.listSharedUsersForServer({
      plexToken: params.plexToken,
      machineIdentifier,
    });
    const refreshCandidates = new Map<
      string,
      { plexAccountId: number | null; plexAccountTitle: string | null }
    >();
    for (const user of sharedUsers) {
      const plexAccountId = toFiniteInt(user.plexAccountId, 0) || null;
      const plexAccountTitle =
        String(user.plexAccountTitle ?? '').trim() || null;
      const key = plexAccountId
        ? `id:${plexAccountId}`
        : `title:${plexAccountTitle}`;
      refreshCandidates.set(key, { plexAccountId, plexAccountTitle });
    }
    for (const candidate of refreshCandidates.values()) {
      await this.plexUsers.getOrCreateByPlexAccount({
        plexAccountId: candidate.plexAccountId,
        plexAccountTitle: candidate.plexAccountTitle,
      });
    }

    const refreshedUsers = await this.prisma.plexUser.findMany({
      select: {
        id: true,
        plexAccountId: true,
        plexAccountTitle: true,
        isAdmin: true,
      },
    });
    const lookup = new Map<string, PlexUserRecord>(
      refreshedUsers.map(
        (u: {
          id: string;
          plexAccountId: number | null;
          plexAccountTitle: string;
          isAdmin: boolean;
        }) => [
          u.id,
          {
            id: u.id,
            plexAccountId: u.plexAccountId ?? null,
            plexAccountTitle: u.plexAccountTitle,
            isAdmin: u.isAdmin,
          },
        ],
      ),
    );

    await params.ctx.info('collectionResyncUpgrade: refreshed Plex users', {
      refreshedUsers: refreshedUsers.length,
      sharedUsersDiscovered: sharedUsers.length,
      machineIdentifier,
    });

    return {
      machineIdentifier,
      adminPlexUser,
      plexUserLookup: lookup,
      usersRefreshed: refreshedUsers.length,
      sharedUsersDiscovered: sharedUsers.length,
    };
  }

  private isAdminPlexUser(params: {
    candidate: PlexUserRecord | null | undefined;
    admin: PlexUserRecord;
  }): boolean {
    const candidate = params.candidate;
    const admin = params.admin;
    if (!candidate) return false;
    if (candidate.id === admin.id) return true;
    if (
      candidate.plexAccountId !== null &&
      admin.plexAccountId !== null &&
      candidate.plexAccountId === admin.plexAccountId
    ) {
      return true;
    }
    const candidateTitle = String(candidate.plexAccountTitle ?? '')
      .trim()
      .toLowerCase();
    const adminTitle = String(admin.plexAccountTitle ?? '')
      .trim()
      .toLowerCase();
    if (candidateTitle && adminTitle && candidateTitle === adminTitle)
      return true;
    return candidate.isAdmin;
  }

  private async buildDeterministicQueue(params: {
    plexUserLookup: Map<string, PlexUserRecord>;
    adminPlexUser: PlexUserRecord;
  }): Promise<CollectionResyncQueueItem[]> {
    type QueueAccumulator = {
      key: string;
      plexUserId: string;
      mediaType: UpgradeMediaType;
      librarySectionKey: string;
      collectionBaseName: string;
      sourceTable: CollectionResyncQueueSourceTable;
      rowCount: number;
      activeRowCount: number;
    };

    const accByKey = new Map<string, QueueAccumulator>();
    const upsertAccumulator = (params: {
      plexUserId: string;
      mediaType: UpgradeMediaType;
      librarySectionKey: string;
      collectionBaseName: string;
      sourceTable: CollectionResyncQueueSourceTable;
      isActive: boolean;
    }) => {
      const key = buildCollectionResyncQueueItemKey({
        plexUserId: params.plexUserId,
        mediaType: params.mediaType,
        librarySectionKey: params.librarySectionKey,
        collectionBaseName: params.collectionBaseName,
      });
      if (!key) return;
      const existing = accByKey.get(key);
      if (existing) {
        existing.rowCount += 1;
        if (params.isActive) existing.activeRowCount += 1;
        return;
      }
      accByKey.set(key, {
        key,
        plexUserId: params.plexUserId,
        mediaType: params.mediaType,
        librarySectionKey: params.librarySectionKey,
        collectionBaseName: params.collectionBaseName,
        sourceTable: params.sourceTable,
        rowCount: 1,
        activeRowCount: params.isActive ? 1 : 0,
      });
    };

    const movieRows = await this.prisma.immaculateTasteMovieLibrary.findMany({
      select: {
        plexUserId: true,
        librarySectionKey: true,
        status: true,
        points: true,
      },
    });
    for (const row of movieRows) {
      upsertAccumulator({
        plexUserId: row.plexUserId,
        mediaType: 'movie',
        librarySectionKey: row.librarySectionKey,
        collectionBaseName: IMMACULATE_BASE_COLLECTION,
        sourceTable: 'ImmaculateTasteMovieLibrary',
        isActive: row.status === 'active' && row.points > 0,
      });
    }

    const showRows = await this.prisma.immaculateTasteShowLibrary.findMany({
      select: {
        plexUserId: true,
        librarySectionKey: true,
        status: true,
        points: true,
      },
    });
    for (const row of showRows) {
      upsertAccumulator({
        plexUserId: row.plexUserId,
        mediaType: 'tv',
        librarySectionKey: row.librarySectionKey,
        collectionBaseName: IMMACULATE_BASE_COLLECTION,
        sourceTable: 'ImmaculateTasteShowLibrary',
        isActive: row.status === 'active' && row.points > 0,
      });
    }

    const watchedMovieRows =
      await this.prisma.watchedMovieRecommendationLibrary.findMany({
        select: {
          plexUserId: true,
          librarySectionKey: true,
          collectionName: true,
          status: true,
        },
      });
    for (const row of watchedMovieRows) {
      const collectionBaseName = String(row.collectionName ?? '').trim();
      if (!collectionBaseName) continue;
      upsertAccumulator({
        plexUserId: row.plexUserId,
        mediaType: 'movie',
        librarySectionKey: row.librarySectionKey,
        collectionBaseName,
        sourceTable: 'WatchedMovieRecommendationLibrary',
        isActive: row.status === 'active',
      });
    }

    const watchedShowRows =
      await this.prisma.watchedShowRecommendationLibrary.findMany({
        select: {
          plexUserId: true,
          librarySectionKey: true,
          collectionName: true,
          status: true,
        },
      });
    for (const row of watchedShowRows) {
      const collectionBaseName = String(row.collectionName ?? '').trim();
      if (!collectionBaseName) continue;
      upsertAccumulator({
        plexUserId: row.plexUserId,
        mediaType: 'tv',
        librarySectionKey: row.librarySectionKey,
        collectionBaseName,
        sourceTable: 'WatchedShowRecommendationLibrary',
        isActive: row.status === 'active',
      });
    }

    const resolvePinTarget = (plexUserId: string): 'admin' | 'friends' => {
      const row = params.plexUserLookup.get(plexUserId);
      return this.isAdminPlexUser({
        candidate: row,
        admin: params.adminPlexUser,
      })
        ? 'admin'
        : 'friends';
    };
    const resolveTitle = (plexUserId: string): string =>
      params.plexUserLookup.get(plexUserId)?.plexAccountTitle ?? 'Unknown';

    const queue = Array.from(accByKey.values()).map((entry) => ({
      key: entry.key,
      plexUserId: entry.plexUserId,
      mediaType: entry.mediaType,
      librarySectionKey: entry.librarySectionKey,
      collectionBaseName: entry.collectionBaseName,
      targetCollectionName: buildUserCollectionName(
        entry.collectionBaseName,
        resolveTitle(entry.plexUserId),
      ),
      sourceTable: entry.sourceTable,
      rowCount: entry.rowCount,
      activeRowCount: entry.activeRowCount,
      pinTarget: resolvePinTarget(entry.plexUserId),
    }));

    return sortQueueItems(queue);
  }

  private syncQueueTargetNames(params: {
    queue: CollectionResyncQueueItem[];
    plexUserLookup: Map<string, PlexUserRecord>;
    adminPlexUser: PlexUserRecord;
    fallbackTitles: Record<string, string>;
  }): CollectionResyncQueueItem[] {
    return params.queue.map((item) => {
      const plexUser = params.plexUserLookup.get(item.plexUserId);
      const title =
        plexUser?.plexAccountTitle ??
        params.fallbackTitles[item.plexUserId] ??
        'Unknown';
      return {
        ...item,
        targetCollectionName: buildUserCollectionName(
          item.collectionBaseName,
          title,
        ),
        pinTarget: this.isAdminPlexUser({
          candidate: plexUser,
          admin: params.adminPlexUser,
        })
          ? 'admin'
          : 'friends',
      };
    });
  }

  private async captureSnapshotAndDeleteQueue(params: {
    state: UpgradeState;
    plexBaseUrl: string;
    plexToken: string;
    suggestionCounts: SuggestionCounts;
  }): Promise<{ snapshot: JsonObject; deleteQueue: UpgradeDeleteQueueItem[] }> {
    if (params.state.snapshot && params.state.deleteQueue.length) {
      return {
        snapshot: params.state.snapshot,
        deleteQueue: params.state.deleteQueue,
      };
    }

    const sections = await this.plexServer.getSections({
      baseUrl: params.plexBaseUrl,
      token: params.plexToken,
    });
    const deleteQueue: UpgradeDeleteQueueItem[] = [];
    const plexInventory: JsonObject[] = [];

    for (const section of sections) {
      const collections = await this.plexServer.listCollectionsForSectionKey({
        baseUrl: params.plexBaseUrl,
        token: params.plexToken,
        librarySectionKey: section.key,
        take: 500,
      });
      plexInventory.push({
        librarySectionKey: section.key,
        libraryTitle: section.title,
        libraryType: section.type ?? '',
        totalCollections: collections.length,
        collections: collections.map((collection) => ({
          ratingKey: collection.ratingKey,
          title: collection.title,
        })),
      });

      for (const collection of collections) {
        deleteQueue.push({
          deleteKey: `delete|${section.key}|${collection.ratingKey}`,
          librarySectionKey: section.key,
          libraryTitle: section.title,
          libraryType: section.type ?? '',
          collectionRatingKey: collection.ratingKey,
          collectionTitle: collection.title,
        });
      }
    }

    deleteQueue.sort((a, b) => {
      if (a.librarySectionKey !== b.librarySectionKey)
        return a.librarySectionKey.localeCompare(b.librarySectionKey);
      return a.collectionTitle.localeCompare(b.collectionTitle);
    });

    const snapshot: JsonObject = {
      capturedAt: nowIso(),
      suggestionCounts: params.suggestionCounts as unknown as JsonValue,
      queue: params.state.queue.map((item) => ({
        key: item.key,
        plexUserId: item.plexUserId,
        mediaType: item.mediaType,
        librarySectionKey: item.librarySectionKey,
        collectionBaseName: item.collectionBaseName,
        targetCollectionName: item.targetCollectionName,
        rowCount: item.rowCount,
        activeRowCount: item.activeRowCount,
      })) as unknown as JsonValue,
      expectedTargets: params.state.queue.map((item) => ({
        key: item.key,
        targetCollectionName: item.targetCollectionName,
        expectedDbRows: item.activeRowCount,
      })) as unknown as JsonValue,
      plexInventory: plexInventory as unknown as JsonValue,
    };

    return { snapshot, deleteQueue };
  }

  private async deleteAllCollections(params: {
    ctx: JobContext;
    state: UpgradeState;
    plexBaseUrl: string;
    plexToken: string;
  }): Promise<{ deleted: number; total: number }> {
    for (const item of params.state.deleteQueue) {
      const progress =
        params.state.deleteProgress[item.deleteKey] ??
        createProgress('plex', 'captured');
      params.state.deleteProgress[item.deleteKey] = progress;

      if (progress.phase === 'done') continue;
      if (progress.phase === 'deleted') {
        markProgressPhase(progress, 'done');
        await this.saveState(params.state);
        continue;
      }
      if (progress.phase === 'pending') markProgressPhase(progress, 'captured');

      await this.runWithRetry({
        source: 'plex',
        operation: 'delete_collection',
        itemKey: item.deleteKey,
        progress,
        state: params.state,
        action: async () => {
          try {
            await this.plexServer.deleteCollection({
              baseUrl: params.plexBaseUrl,
              token: params.plexToken,
              collectionRatingKey: item.collectionRatingKey,
            });
          } catch (err) {
            if (isNotFoundError(err)) return;
            throw err;
          }
        },
      });

      markProgressPhase(progress, 'deleted');
      markProgressPhase(progress, 'done');
      if (
        !params.state.deletedCollections.find(
          (entry) => entry.deleteKey === item.deleteKey,
        )
      ) {
        params.state.deletedCollections.push({
          deleteKey: item.deleteKey,
          librarySectionKey: item.librarySectionKey,
          collectionRatingKey: item.collectionRatingKey,
          collectionTitle: item.collectionTitle,
          deletedAt: nowIso(),
        });
      }
      await this.saveState(params.state);
      await this.refreshLock();
      await sleep(ITEM_PACING_MS);
    }

    const done = Object.values(params.state.deleteProgress).filter(
      (progress) => progress.phase === 'done',
    ).length;
    return { deleted: done, total: params.state.deleteQueue.length };
  }

  private async recreateCollectionsSequentially(params: {
    ctx: JobContext;
    state: UpgradeState;
    plexBaseUrl: string;
    plexToken: string;
    machineIdentifier: string;
    watchedLimit: number;
  }): Promise<{ done: number; recreated: number; emptyDesired: number }> {
    const movieIndexBySection = new Map<
      string,
      Map<number, { ratingKey: string; title: string }>
    >();
    const tvIndexBySection = new Map<
      string,
      Map<number, { ratingKey: string; title: string }>
    >();

    let recreated = 0;
    let emptyDesired = 0;

    const pendingItems = getPendingQueueItemsInOrder({
      queue: params.state.queue,
      itemProgress: params.state.itemProgress,
    });

    for (let index = 0; index < pendingItems.length; index += 1) {
      const item = pendingItems[index]!;
      const progress =
        params.state.itemProgress[item.key] ??
        createProgress('immaculaterr', 'captured');
      params.state.itemProgress[item.key] = progress;

      await params.ctx.info('collectionResyncUpgrade: processing queue item', {
        itemKey: item.key,
        index: index + 1,
        total: pendingItems.length,
        phase: progress.phase,
        targetCollectionName: item.targetCollectionName,
      });

      if (progress.phase === 'pending') {
        markProgressPhase(progress, 'captured');
        await this.saveState(params.state);
      }

      const desiredItems = await this.buildDesiredItemsForQueueItem({
        item,
        watchedLimit: params.watchedLimit,
        movieIndexBySection,
        tvIndexBySection,
        plexBaseUrl: params.plexBaseUrl,
        plexToken: params.plexToken,
      });

      if (progress.phase === 'captured' || progress.phase === 'failed') {
        await this.runWithRetry({
          source: 'plex',
          operation: 'delete_target_collection',
          itemKey: item.key,
          progress,
          state: params.state,
          action: async () => {
            const existing = await this.plexServer.findCollectionRatingKey({
              baseUrl: params.plexBaseUrl,
              token: params.plexToken,
              librarySectionKey: item.librarySectionKey,
              collectionName: item.targetCollectionName,
            });
            if (!existing) return;
            try {
              await this.plexServer.deleteCollection({
                baseUrl: params.plexBaseUrl,
                token: params.plexToken,
                collectionRatingKey: existing,
              });
            } catch (err) {
              if (isNotFoundError(err)) return;
              throw err;
            }
          },
        });
        markProgressPhase(progress, 'deleted');
        await this.saveState(params.state);
      }

      if (progress.phase === 'deleted') {
        if (desiredItems.length > 0) {
          const plexUserTitle = extractPlexUserTitleFromCollectionName(
            item.targetCollectionName,
          );
          const collectionHubOrder =
            item.mediaType === 'tv'
              ? buildUserCollectionHubOrder(
                  CURATED_TV_COLLECTION_HUB_ORDER,
                  plexUserTitle,
                )
              : buildUserCollectionHubOrder(
                  CURATED_MOVIE_COLLECTION_HUB_ORDER,
                  plexUserTitle,
                );
          await this.runWithRetry({
            source: 'plex',
            operation: 'recreate_collection',
            itemKey: item.key,
            progress,
            state: params.state,
            action: async () => {
              await this.plexCurated.rebuildMovieCollection({
                ctx: params.ctx,
                baseUrl: params.plexBaseUrl,
                token: params.plexToken,
                machineIdentifier: params.machineIdentifier,
                movieSectionKey: item.librarySectionKey,
                itemType: item.mediaType === 'tv' ? 2 : 1,
                collectionName: item.targetCollectionName,
                desiredItems,
                randomizeOrder: false,
                pinCollections: true,
                pinTarget: item.pinTarget,
                collectionHubOrder,
              });
            },
          });
          recreated += 1;
        } else {
          emptyDesired += 1;
        }
        markProgressPhase(progress, 'recreated');
        await this.saveState(params.state);
      }

      if (progress.phase === 'recreated') {
        await this.runWithRetry({
          source: 'plex',
          operation: 'verify_collection',
          itemKey: item.key,
          progress,
          state: params.state,
          action: async () => {
            const key = await this.plexServer.findCollectionRatingKey({
              baseUrl: params.plexBaseUrl,
              token: params.plexToken,
              librarySectionKey: item.librarySectionKey,
              collectionName: item.targetCollectionName,
            });
            if (!key && desiredItems.length > 0) {
              throw new Error(
                `Collection not found after recreate: ${item.targetCollectionName}`,
              );
            }
            if (!key) return;
            const collectionItems = await this.plexServer.getCollectionItems({
              baseUrl: params.plexBaseUrl,
              token: params.plexToken,
              collectionRatingKey: key,
            });
            if (
              !Number.isFinite(collectionItems.length) ||
              collectionItems.length < 0
            ) {
              throw new Error(
                `Invalid collection item count for ${item.targetCollectionName}`,
              );
            }
          },
        });
        markProgressPhase(progress, 'verified');
        await this.saveState(params.state);
      }

      if (progress.phase === 'verified') {
        markProgressPhase(progress, 'done');
        await this.saveState(params.state);
      }

      await this.refreshLock();
      await sleep(ITEM_PACING_MS);
    }

    const done = Object.values(params.state.itemProgress).filter(
      (progress) => progress.phase === 'done',
    ).length;
    return { done, recreated, emptyDesired };
  }

  private async buildDesiredItemsForQueueItem(params: {
    item: CollectionResyncQueueItem;
    watchedLimit: number;
    movieIndexBySection: Map<
      string,
      Map<number, { ratingKey: string; title: string }>
    >;
    tvIndexBySection: Map<
      string,
      Map<number, { ratingKey: string; title: string }>
    >;
    plexBaseUrl: string;
    plexToken: string;
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    const item = params.item;
    const getMovieMap = async () => {
      if (params.movieIndexBySection.has(item.librarySectionKey)) {
        return params.movieIndexBySection.get(item.librarySectionKey)!;
      }
      const rows = await this.plexServer.listMoviesWithTmdbIdsForSectionKey({
        baseUrl: params.plexBaseUrl,
        token: params.plexToken,
        librarySectionKey: item.librarySectionKey,
      });
      const map = new Map<number, { ratingKey: string; title: string }>();
      for (const row of rows) {
        if (!row.tmdbId) continue;
        if (!map.has(row.tmdbId)) {
          map.set(row.tmdbId, { ratingKey: row.ratingKey, title: row.title });
        }
      }
      params.movieIndexBySection.set(item.librarySectionKey, map);
      return map;
    };
    const getTvMap = async () => {
      if (params.tvIndexBySection.has(item.librarySectionKey)) {
        return params.tvIndexBySection.get(item.librarySectionKey)!;
      }
      const rows = await this.plexServer.listShowsWithTvdbIdsForSectionKey({
        baseUrl: params.plexBaseUrl,
        token: params.plexToken,
        librarySectionKey: item.librarySectionKey,
      });
      const map = new Map<number, { ratingKey: string; title: string }>();
      for (const row of rows) {
        if (!row.tvdbId) continue;
        if (!map.has(row.tvdbId)) {
          map.set(row.tvdbId, { ratingKey: row.ratingKey, title: row.title });
        }
      }
      params.tvIndexBySection.set(item.librarySectionKey, map);
      return map;
    };

    const desired: Array<{ ratingKey: string; title: string }> = [];
    const seen = new Set<string>();

    if (item.mediaType === 'movie') {
      const movieMap = await getMovieMap();
      if (item.collectionBaseName === IMMACULATE_BASE_COLLECTION) {
        const active = await this.immaculateMovies.getActiveMovies({
          plexUserId: item.plexUserId,
          librarySectionKey: item.librarySectionKey,
          minPoints: 1,
        });
        for (const row of active) {
          const mapped = movieMap.get(row.tmdbId);
          if (!mapped) continue;
          if (seen.has(mapped.ratingKey)) continue;
          seen.add(mapped.ratingKey);
          desired.push(mapped);
        }
      } else {
        const active =
          await this.prisma.watchedMovieRecommendationLibrary.findMany({
            where: {
              plexUserId: item.plexUserId,
              librarySectionKey: item.librarySectionKey,
              collectionName: item.collectionBaseName,
              status: 'active',
            },
            select: { tmdbId: true },
            orderBy: [{ updatedAt: 'desc' }, { tmdbId: 'asc' }],
          });
        const limited = active.slice(0, params.watchedLimit);
        for (const row of limited) {
          const mapped = movieMap.get(row.tmdbId);
          if (!mapped) continue;
          if (seen.has(mapped.ratingKey)) continue;
          seen.add(mapped.ratingKey);
          desired.push(mapped);
        }
      }
      return desired;
    }

    const tvMap = await getTvMap();
    if (item.collectionBaseName === IMMACULATE_BASE_COLLECTION) {
      const active = await this.immaculateShows.getActiveShows({
        plexUserId: item.plexUserId,
        librarySectionKey: item.librarySectionKey,
        minPoints: 1,
      });
      for (const row of active) {
        const mapped = tvMap.get(row.tvdbId);
        if (!mapped) continue;
        if (seen.has(mapped.ratingKey)) continue;
        seen.add(mapped.ratingKey);
        desired.push(mapped);
      }
    } else {
      const active =
        await this.prisma.watchedShowRecommendationLibrary.findMany({
          where: {
            plexUserId: item.plexUserId,
            librarySectionKey: item.librarySectionKey,
            collectionName: item.collectionBaseName,
            status: 'active',
          },
          select: { tvdbId: true },
          orderBy: [{ updatedAt: 'desc' }, { tvdbId: 'asc' }],
        });
      const limited = active.slice(0, params.watchedLimit);
      for (const row of limited) {
        const mapped = tvMap.get(row.tvdbId);
        if (!mapped) continue;
        if (seen.has(mapped.ratingKey)) continue;
        seen.add(mapped.ratingKey);
        desired.push(mapped);
      }
    }
    return desired;
  }

  private async verifyAndFinalize(params: {
    state: UpgradeState;
  }): Promise<{
    completedAt: string;
    deleteDone: number;
    recreateDone: number;
  }> {
    const pendingDeletes = params.state.deleteQueue.filter(
      (item) => params.state.deleteProgress[item.deleteKey]?.phase !== 'done',
    );
    if (pendingDeletes.length > 0) {
      throw new UpgradeOperationError(
        'immaculaterr',
        'verification_pending_delete_items',
        pendingDeletes[0]?.deleteKey ?? 'delete_queue',
        `Delete phase still has ${pendingDeletes.length} incomplete items.`,
      );
    }

    const pendingRecreate = getPendingQueueItemsInOrder({
      queue: params.state.queue,
      itemProgress: params.state.itemProgress,
    });
    if (pendingRecreate.length > 0) {
      throw new UpgradeOperationError(
        'immaculaterr',
        'verification_pending_recreate_items',
        pendingRecreate[0]?.key ?? 'recreate_queue',
        `Recreate phase still has ${pendingRecreate.length} incomplete items.`,
      );
    }

    const completedAt = nowIso();
    await this.writeCompletedAt(completedAt);
    params.state.phases.finalizedAt = completedAt;
    await this.saveState(params.state);
    return {
      completedAt,
      deleteDone: params.state.deleteQueue.length,
      recreateDone: params.state.queue.length,
    };
  }

  private async runWithRetry(params: {
    source: UpgradeSource;
    operation: string;
    itemKey: string;
    progress: UpgradeItemProgress;
    state: UpgradeState;
    action: () => Promise<void>;
  }): Promise<void> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= ITEM_RETRY_MAX; attempt += 1) {
      try {
        await params.action();
        params.progress.lastError = null;
        return;
      } catch (err) {
        lastErr = err;
        params.progress.attempts += 1;
        params.progress.lastError = safeErrorMessage(err);
        markProgressPhase(params.progress, 'failed');
        await this.saveState(params.state);
        if (attempt < ITEM_RETRY_MAX) {
          await sleep(this.retryBackoffMs(attempt));
          continue;
        }
      }
    }

    throw new UpgradeOperationError(
      params.source,
      params.operation,
      params.itemKey,
      safeErrorMessage(lastErr),
    );
  }

  private retryBackoffMs(attempt: number): number {
    const exp = Math.max(0, Math.min(5, attempt - 1));
    return 350 * 2 ** exp;
  }

  private asFailureRecord(err: unknown): UpgradeFailure {
    if (err instanceof UpgradeOperationError) {
      return {
        source: err.source,
        operation: err.operation,
        itemKey: err.itemKey,
        message: err.message,
        restartGuidance: RESTART_GUIDANCE,
        at: nowIso(),
      };
    }
    return {
      source: 'immaculaterr',
      operation: 'unhandled_error',
      itemKey: 'upgrade',
      message: safeErrorMessage(err),
      restartGuidance: RESTART_GUIDANCE,
      at: nowIso(),
    };
  }

  private createEmptyState(adminUserId: string): UpgradeState {
    const stamp = nowIso();
    return {
      version: 1,
      startedAt: stamp,
      updatedAt: stamp,
      adminUserId,
      preRefreshUserTitles: {},
      queue: [],
      itemProgress: {},
      deleteQueue: [],
      deleteProgress: {},
      deletedCollections: [],
      snapshot: null,
      failures: [],
      phases: {
        queueBuiltAt: null,
        captureCompletedAt: null,
        deleteCompletedAt: null,
        recreateCompletedAt: null,
        finalizedAt: null,
      },
    };
  }

  private async loadState(): Promise<UpgradeState | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: COLLECTION_RESYNC_UPGRADE_STATE_KEY },
    });
    const raw = row?.value?.trim();
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      throw new UpgradeOperationError(
        'immaculaterr',
        'load_state',
        COLLECTION_RESYNC_UPGRADE_STATE_KEY,
        `Failed to parse upgrade state JSON: ${safeErrorMessage(err)}`,
      );
    }
    if (!isPlainObject(parsed)) {
      throw new UpgradeOperationError(
        'immaculaterr',
        'load_state',
        COLLECTION_RESYNC_UPGRADE_STATE_KEY,
        'Upgrade state JSON is not an object.',
      );
    }

    const state = this.createEmptyState(
      String(parsed['adminUserId'] ?? '').trim(),
    );
    state.startedAt = String(parsed['startedAt'] ?? state.startedAt);
    state.updatedAt = String(parsed['updatedAt'] ?? state.updatedAt);
    state.adminUserId = String(parsed['adminUserId'] ?? '').trim();
    state.preRefreshUserTitles = isPlainObject(parsed['preRefreshUserTitles'])
      ? Object.fromEntries(
          Object.entries(parsed['preRefreshUserTitles']).map(([k, v]) => [
            k,
            String(v ?? ''),
          ]),
        )
      : {};
    state.snapshot = asJsonObject(parsed['snapshot']);

    const queueRaw = Array.isArray(parsed['queue']) ? parsed['queue'] : [];
    state.queue = queueRaw
      .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
      .map((entry): CollectionResyncQueueItem => {
        const collectionBaseName = String(
          entry['collectionBaseName'] ?? '',
        ).trim();
        const mediaType: UpgradeMediaType =
          String(entry['mediaType'] ?? '').trim() === 'tv' ? 'tv' : 'movie';
        const plexUserId = String(entry['plexUserId'] ?? '').trim();
        const librarySectionKey = String(
          entry['librarySectionKey'] ?? '',
        ).trim();
        const key =
          String(entry['key'] ?? '').trim() ||
          buildCollectionResyncQueueItemKey({
            plexUserId,
            mediaType,
            librarySectionKey,
            collectionBaseName,
          });
        const sourceTableRaw = String(entry['sourceTable'] ?? '').trim();
        const sourceTable: CollectionResyncQueueSourceTable =
          sourceTableRaw === 'ImmaculateTasteMovieLibrary' ||
          sourceTableRaw === 'ImmaculateTasteShowLibrary' ||
          sourceTableRaw === 'WatchedMovieRecommendationLibrary' ||
          sourceTableRaw === 'WatchedShowRecommendationLibrary'
            ? sourceTableRaw
            : mediaType === 'tv'
              ? 'WatchedShowRecommendationLibrary'
              : 'WatchedMovieRecommendationLibrary';
        const pinTarget: 'admin' | 'friends' =
          String(entry['pinTarget'] ?? '').trim() === 'friends'
            ? 'friends'
            : 'admin';
        return {
          key,
          plexUserId,
          mediaType,
          librarySectionKey,
          collectionBaseName,
          targetCollectionName: String(
            entry['targetCollectionName'] ?? '',
          ).trim(),
          sourceTable,
          rowCount: toFiniteInt(entry['rowCount'], 0),
          activeRowCount: toFiniteInt(entry['activeRowCount'], 0),
          pinTarget,
        };
      })
      .filter(
        (entry) =>
          entry.key &&
          entry.plexUserId &&
          entry.librarySectionKey &&
          entry.collectionBaseName,
      );

    const coerceProgressMap = (
      rawProgress: unknown,
    ): Record<string, UpgradeItemProgress> => {
      if (!isPlainObject(rawProgress)) return {};
      const out: Record<string, UpgradeItemProgress> = {};
      for (const [key, value] of Object.entries(rawProgress)) {
        if (!isPlainObject(value)) continue;
        const phaseRaw = String(value['phase'] ?? 'pending').trim();
        const phase: UpgradePhase = (
          [
            'pending',
            'captured',
            'deleted',
            'recreated',
            'verified',
            'done',
            'failed',
          ] as UpgradePhase[]
        ).includes(phaseRaw as UpgradePhase)
          ? (phaseRaw as UpgradePhase)
          : 'pending';
        out[key] = {
          phase,
          source:
            String(value['source'] ?? '') === 'plex' ? 'plex' : 'immaculaterr',
          attempts: toFiniteInt(value['attempts'], 0),
          lastError:
            typeof value['lastError'] === 'string'
              ? String(value['lastError'])
              : null,
          updatedAt: String(value['updatedAt'] ?? nowIso()),
          capturedAt:
            typeof value['capturedAt'] === 'string'
              ? String(value['capturedAt'])
              : null,
          deletedAt:
            typeof value['deletedAt'] === 'string'
              ? String(value['deletedAt'])
              : null,
          recreatedAt:
            typeof value['recreatedAt'] === 'string'
              ? String(value['recreatedAt'])
              : null,
          verifiedAt:
            typeof value['verifiedAt'] === 'string'
              ? String(value['verifiedAt'])
              : null,
          doneAt:
            typeof value['doneAt'] === 'string'
              ? String(value['doneAt'])
              : null,
        };
      }
      return out;
    };

    state.itemProgress = coerceProgressMap(parsed['itemProgress']);
    state.deleteProgress = coerceProgressMap(parsed['deleteProgress']);

    state.deleteQueue = (
      Array.isArray(parsed['deleteQueue']) ? parsed['deleteQueue'] : []
    )
      .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
      .map((entry) => ({
        deleteKey: String(entry['deleteKey'] ?? '').trim(),
        librarySectionKey: String(entry['librarySectionKey'] ?? '').trim(),
        libraryTitle: String(entry['libraryTitle'] ?? '').trim(),
        libraryType: String(entry['libraryType'] ?? '').trim(),
        collectionRatingKey: String(entry['collectionRatingKey'] ?? '').trim(),
        collectionTitle: String(entry['collectionTitle'] ?? '').trim(),
      }))
      .filter((entry) => entry.deleteKey && entry.collectionRatingKey);

    state.deletedCollections = (
      Array.isArray(parsed['deletedCollections'])
        ? parsed['deletedCollections']
        : []
    )
      .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
      .map((entry) => ({
        deleteKey: String(entry['deleteKey'] ?? '').trim(),
        librarySectionKey: String(entry['librarySectionKey'] ?? '').trim(),
        collectionRatingKey: String(entry['collectionRatingKey'] ?? '').trim(),
        collectionTitle: String(entry['collectionTitle'] ?? '').trim(),
        deletedAt: String(entry['deletedAt'] ?? nowIso()),
      }))
      .filter((entry) => entry.deleteKey);

    state.failures = (
      Array.isArray(parsed['failures']) ? parsed['failures'] : []
    )
      .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
      .map((entry) => ({
        source:
          String(entry['source'] ?? '') === 'plex' ? 'plex' : 'immaculaterr',
        operation: String(entry['operation'] ?? '').trim(),
        itemKey: String(entry['itemKey'] ?? '').trim(),
        message: String(entry['message'] ?? '').trim(),
        restartGuidance:
          String(entry['restartGuidance'] ?? '').trim() || RESTART_GUIDANCE,
        at: String(entry['at'] ?? nowIso()),
      }));

    const phases = isPlainObject(parsed['phases']) ? parsed['phases'] : {};
    state.phases = {
      queueBuiltAt:
        typeof phases['queueBuiltAt'] === 'string'
          ? String(phases['queueBuiltAt'])
          : null,
      captureCompletedAt:
        typeof phases['captureCompletedAt'] === 'string'
          ? String(phases['captureCompletedAt'])
          : null,
      deleteCompletedAt:
        typeof phases['deleteCompletedAt'] === 'string'
          ? String(phases['deleteCompletedAt'])
          : null,
      recreateCompletedAt:
        typeof phases['recreateCompletedAt'] === 'string'
          ? String(phases['recreateCompletedAt'])
          : null,
      finalizedAt:
        typeof phases['finalizedAt'] === 'string'
          ? String(phases['finalizedAt'])
          : null,
    };

    return state;
  }

  private async saveState(state: UpgradeState): Promise<void> {
    state.updatedAt = nowIso();
    await this.putSettingValue(
      COLLECTION_RESYNC_UPGRADE_STATE_KEY,
      JSON.stringify(state),
    );
  }

  private async acquireLock(): Promise<{
    acquired: boolean;
    lockUntil: string | null;
  }> {
    const nowMs = Date.now();
    const existing = await this.getSettingValue(
      COLLECTION_RESYNC_UPGRADE_LOCK_UNTIL_KEY,
    );
    if (existing) {
      const lockMs = Date.parse(existing);
      if (Number.isFinite(lockMs) && lockMs > nowMs) {
        return {
          acquired: false,
          lockUntil: new Date(lockMs).toISOString(),
        };
      }
    }

    const lockUntil = new Date(nowMs + LOCK_TTL_MS).toISOString();
    await this.putSettingValue(
      COLLECTION_RESYNC_UPGRADE_LOCK_UNTIL_KEY,
      lockUntil,
    );
    return { acquired: true, lockUntil };
  }

  private async refreshLock(): Promise<void> {
    const lockUntil = new Date(Date.now() + LOCK_TTL_MS).toISOString();
    await this.putSettingValue(
      COLLECTION_RESYNC_UPGRADE_LOCK_UNTIL_KEY,
      lockUntil,
    );
  }

  private async releaseLock(): Promise<void> {
    await this.prisma.setting
      .deleteMany({
        where: { key: COLLECTION_RESYNC_UPGRADE_LOCK_UNTIL_KEY },
      })
      .catch(() => undefined);
  }

  private async writeCompletedAt(value: string): Promise<void> {
    await this.putSettingValue(
      COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY,
      value,
    );
  }

  private async getSettingValue(key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const value = row?.value?.trim() ?? '';
    return value || null;
  }

  private async putSettingValue(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      update: {
        value,
        encrypted: false,
      },
      create: {
        key,
        value,
        encrypted: false,
      },
    });
  }
}
