export type ServerLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ServerLogEntry = {
  id: number;
  time: string; // ISO
  level: ServerLogLevel;
  message: string;
};

// Keep the last N messages in-memory (circular buffer).
// Plex-related operations can be very chatty; keep more history so the UI doesn't
// look like it's "filtering out" logs.
const MAX_ENTRIES = 5000;

let nextId = 1;
const ring: Array<ServerLogEntry | null> = Array.from({ length: MAX_ENTRIES }, () => null);
let writeIndex = 0;
let count = 0;

function normalizeMessage(input: unknown): string {
  if (input instanceof Error) return input.stack ?? input.message;
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return '';
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function addServerLog(params: {
  level: ServerLogLevel;
  message: unknown;
  stack?: unknown;
}) {
  const msg = normalizeMessage(params.message).trim();
  const stack = normalizeMessage(params.stack).trim();
  const combined = stack ? (msg ? `${msg}\n${stack}` : stack) : msg;
  if (!combined) return;

  ring[writeIndex] = {
    id: nextId++,
    time: new Date().toISOString(),
    level: params.level,
    message: combined.length > 10_000 ? `${combined.slice(0, 10_000)}…` : combined,
  };
  writeIndex = (writeIndex + 1) % MAX_ENTRIES;
  count = Math.min(MAX_ENTRIES, count + 1);
}

export function listServerLogs(params?: {
  afterId?: number;
  limit?: number;
}): { logs: ServerLogEntry[]; latestId: number } {
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


