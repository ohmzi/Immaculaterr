import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

// An Observatory apply rebuilds a whole Plex collection: it lists every item
// in the library section, works out the desired order, then reconciles the
// collection through Plex. On a large library that comfortably outlives the
// 100s origin timeout most reverse proxies (Cloudflare included) enforce, so
// running it inside the HTTP request meant the caller got a gateway timeout
// while the work carried on invisibly on the server.
//
// The work is instead started in the background and tracked here: the POST
// answers immediately with a handle, and the client polls that handle for the
// outcome. Deliberately in-memory rather than on the global job queue — that
// queue runs exactly one job at a time server-wide, so an apply (which fires
// after every swipe) would sit behind multi-minute Cutting Room scans and
// flood Rewind with a run per card.

export type ObservatoryApplyStatus = 'running' | 'succeeded' | 'failed';

export type ObservatoryApplyRecord = {
  id: string;
  userId: string;
  key: string;
  status: ObservatoryApplyStatus;
  startedAt: number;
  finishedAt: number | null;
  result: unknown;
  error: string | null;
};

// How long a finished record stays pollable. Long enough for a client that
// backed off, reloaded, or briefly lost the network to still collect its
// outcome; short enough that the map cannot grow without bound.
const FINISHED_RECORD_TTL_MS = 15 * 60 * 1000;
// A running apply that never reported back is treated as lost after this, so
// a crashed or hung run cannot block its key forever.
const RUNNING_RECORD_MAX_AGE_MS = 30 * 60 * 1000;
// Hard ceiling on retained records, oldest evicted first.
const MAX_RECORDS = 200;

function readErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === 'string' && err.trim()) return err.trim();
  return 'Apply failed';
}

@Injectable()
export class ObservatoryApplyRunner {
  private readonly logger = new Logger(ObservatoryApplyRunner.name);
  private readonly records = new Map<string, ObservatoryApplyRecord>();
  // key -> id of the apply currently running for it.
  private readonly runningByKey = new Map<string, string>();

  /**
   * Build the coalescing key for an apply. One in-flight apply per user,
   * media type and library section: a second request for the same target
   * joins the running one instead of starting a duplicate rebuild.
   */
  buildKey(params: {
    userId: string;
    scope: string;
    mediaType: string;
    librarySectionKey: string;
    collectionKind?: string;
  }): string {
    return [
      params.userId,
      params.scope,
      params.mediaType,
      params.librarySectionKey,
      params.collectionKind ?? '',
    ].join('|');
  }

  /**
   * Start an apply in the background, or return the one already running for
   * this key. Never rejects: the outcome is recorded on the returned handle.
   */
  start(params: {
    userId: string;
    key: string;
    run: () => Promise<unknown>;
  }): ObservatoryApplyRecord {
    this.prune();

    const existingId = this.runningByKey.get(params.key);
    if (existingId) {
      const existing = this.records.get(existingId);
      if (existing && existing.status === 'running') return existing;
      // Record vanished or already settled — the key is stale, drop it.
      this.runningByKey.delete(params.key);
    }

    const record: ObservatoryApplyRecord = {
      id: randomUUID(),
      userId: params.userId,
      key: params.key,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      result: null,
      error: null,
    };
    this.records.set(record.id, record);
    this.runningByKey.set(params.key, record.id);

    // Detached on purpose: the HTTP response has already been sent by the
    // time this settles. Every failure path is captured onto the record, so
    // nothing here can surface as an unhandled rejection.
    void (async () => {
      try {
        const result = await params.run();
        record.status = 'succeeded';
        record.result = result ?? null;
      } catch (err) {
        record.status = 'failed';
        record.error = readErrorMessage(err);
        this.logger.warn(
          `Observatory apply failed (${record.id}): ${record.error}`,
        );
      } finally {
        record.finishedAt = Date.now();
        if (this.runningByKey.get(params.key) === record.id) {
          this.runningByKey.delete(params.key);
        }
      }
    })();

    return record;
  }

  get(params: { userId: string; id: string }): ObservatoryApplyRecord {
    this.prune();
    const record = this.records.get(params.id);
    // Same 404 for "never existed", "expired" and "someone else's" — a
    // caller has no business distinguishing another user's ids from unused
    // ones.
    if (!record || record.userId !== params.userId) {
      throw new NotFoundException('Apply not found');
    }
    return record;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, record] of this.records) {
      const expired =
        record.status === 'running'
          ? now - record.startedAt > RUNNING_RECORD_MAX_AGE_MS
          : now - (record.finishedAt ?? record.startedAt) >
            FINISHED_RECORD_TTL_MS;
      if (!expired) continue;
      this.records.delete(id);
      if (this.runningByKey.get(record.key) === id) {
        this.runningByKey.delete(record.key);
      }
    }

    // Map iteration is insertion-ordered, so the oldest records come first.
    if (this.records.size <= MAX_RECORDS) return;
    for (const [id, record] of this.records) {
      if (this.records.size <= MAX_RECORDS) break;
      if (record.status === 'running') continue;
      this.records.delete(id);
    }
  }
}

/**
 * Shape sent to clients. Deliberately drops `userId` and the coalescing key —
 * neither is any of the caller's business.
 */
export function serializeApplyRecord(record: ObservatoryApplyRecord): {
  applyId: string;
  status: ObservatoryApplyStatus;
  startedAt: string;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
} {
  return {
    applyId: record.id,
    status: record.status,
    startedAt: new Date(record.startedAt).toISOString(),
    finishedAt: record.finishedAt
      ? new Date(record.finishedAt).toISOString()
      : null,
    result: record.result,
    error: record.error,
  };
}
