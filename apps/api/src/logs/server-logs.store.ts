import { inspect } from 'node:util';

export type ServerLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ServerLogEntry = {
  id: number;
  time: string; // ISO
  level: ServerLogLevel;
  message: string;
  context: string | null;
};

// Ignore chatty Nest boot/framework logs (not useful for Immaculaterr monitoring).
// Errors are always kept regardless of context.
const IGNORED_CONTEXTS = new Set<string>([
  'NestFactory',
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'MiddlewareModule',
]);

// Keep the last N messages in-memory (circular buffer).
// Plex-related operations can be very chatty; keep more history so the UI doesn't
// look like it's "filtering out" logs.
const MAX_ENTRIES = 5000;

let nextId = 1;
const ring: Array<ServerLogEntry | null> = Array.from(
  { length: MAX_ENTRIES },
  () => null,
);
let writeIndex = 0;
let count = 0;

export function clearServerLogs() {
  for (let i = 0; i < ring.length; i += 1) ring[i] = null;
  writeIndex = 0;
  count = 0;
  // Intentionally do not reset nextId: it avoids UI/client confusion with afterId.
}

export function pruneServerLogsOlderThan(cutoff: Date): {
  removed: number;
  kept: number;
} {
  if (!count) return { removed: 0, kept: 0 };
  const cutoffMs = cutoff.getTime();
  if (!Number.isFinite(cutoffMs)) return { removed: 0, kept: count };

  const { logs } = listServerLogs({ limit: MAX_ENTRIES });
  const kept = logs.filter((l) => {
    const ms = Date.parse(l.time);
    return Number.isFinite(ms) ? ms >= cutoffMs : true;
  });

  // Rebuild ring from kept logs.
  for (let i = 0; i < ring.length; i += 1) ring[i] = null;
  writeIndex = 0;
  count = 0;
  for (const entry of kept.slice(-MAX_ENTRIES)) {
    ring[writeIndex] = entry;
    writeIndex = (writeIndex + 1) % MAX_ENTRIES;
    count = Math.min(MAX_ENTRIES, count + 1);
  }

  return { removed: Math.max(0, logs.length - kept.length), kept: kept.length };
}

function normalizeMessage(input: unknown): string {
  if (input instanceof Error) return input.stack ?? input.message;
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return '';
  if (
    typeof input === 'number' ||
    typeof input === 'boolean' ||
    typeof input === 'bigint'
  ) {
    return String(input);
  }
  if (typeof input === 'symbol') {
    return input.description ? `Symbol(${input.description})` : 'Symbol()';
  }
  try {
    const json = JSON.stringify(input);
    return typeof json === 'string'
      ? json
      : inspect(input, { depth: 6, maxArrayLength: 50 });
  } catch {
    // Handles circular references and avoids "[object Object]" stringification.
    return inspect(input, { depth: 6, maxArrayLength: 50 });
  }
}

export function addServerLog(params: {
  level: ServerLogLevel;
  message: unknown;
  stack?: unknown;
  context?: unknown;
}) {
  const msg = normalizeMessage(params.message).trim();
  const stack = normalizeMessage(params.stack).trim();
  const combined = stack ? (msg ? `${msg}\n${stack}` : stack) : msg;
  if (!combined) return;

  const contextRaw =
    typeof params.context === 'string' ? params.context.trim() : '';
  const context = contextRaw ? contextRaw : null;

  if (
    params.level !== 'error' &&
    context &&
    IGNORED_CONTEXTS.has(context) &&
    // keep explicit warnings even if emitted by Nest internals
    params.level !== 'warn'
  ) {
    return;
  }

  ring[writeIndex] = {
    id: nextId++,
    time: new Date().toISOString(),
    level: params.level,
    message:
      combined.length > 10_000 ? `${combined.slice(0, 10_000)}…` : combined,
    context,
  };
  writeIndex = (writeIndex + 1) % MAX_ENTRIES;
  count = Math.min(MAX_ENTRIES, count + 1);
}

export function listServerLogs(params?: { afterId?: number; limit?: number }): {
  logs: ServerLogEntry[];
  latestId: number;
} {
  const latestId = nextId - 1;
  const limit = Math.max(1, Math.min(MAX_ENTRIES, params?.limit ?? 200));
  const afterId = params?.afterId ?? null;

  if (!count) return { logs: [], latestId };

  // Build chronological list from the ring buffer.
  const oldestIndex = count === MAX_ENTRIES ? writeIndex : 0;
  const ordered: ServerLogEntry[] = [];
  for (let i = 0; i < count; i++) {
    const idx = (oldestIndex + i) % MAX_ENTRIES;
    const entry = ring[idx];
    if (entry) ordered.push(entry);
  }

  const filtered =
    afterId === null ? ordered : ordered.filter((l) => l.id > afterId);
  return { logs: filtered.slice(-limit), latestId };
}
