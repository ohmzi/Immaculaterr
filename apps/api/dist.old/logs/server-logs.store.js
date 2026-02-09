"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearServerLogs = clearServerLogs;
exports.pruneServerLogsOlderThan = pruneServerLogsOlderThan;
exports.addServerLog = addServerLog;
exports.listServerLogs = listServerLogs;
const node_util_1 = require("node:util");
const IGNORED_CONTEXTS = new Set([
    'NestFactory',
    'InstanceLoader',
    'RoutesResolver',
    'RouterExplorer',
    'MiddlewareModule',
]);
const MAX_ENTRIES = 5000;
let nextId = 1;
const ring = Array.from({ length: MAX_ENTRIES }, () => null);
let writeIndex = 0;
let count = 0;
function clearServerLogs() {
    for (let i = 0; i < ring.length; i += 1)
        ring[i] = null;
    writeIndex = 0;
    count = 0;
}
function pruneServerLogsOlderThan(cutoff) {
    if (!count)
        return { removed: 0, kept: 0 };
    const cutoffMs = cutoff.getTime();
    if (!Number.isFinite(cutoffMs))
        return { removed: 0, kept: count };
    const { logs } = listServerLogs({ limit: MAX_ENTRIES });
    const kept = logs.filter((l) => {
        const ms = Date.parse(l.time);
        return Number.isFinite(ms) ? ms >= cutoffMs : true;
    });
    for (let i = 0; i < ring.length; i += 1)
        ring[i] = null;
    writeIndex = 0;
    count = 0;
    for (const entry of kept.slice(-MAX_ENTRIES)) {
        ring[writeIndex] = entry;
        writeIndex = (writeIndex + 1) % MAX_ENTRIES;
        count = Math.min(MAX_ENTRIES, count + 1);
    }
    return { removed: Math.max(0, logs.length - kept.length), kept: kept.length };
}
function normalizeMessage(input) {
    if (input instanceof Error)
        return input.stack ?? input.message;
    if (typeof input === 'string')
        return input;
    if (input === null || input === undefined)
        return '';
    if (typeof input === 'number' ||
        typeof input === 'boolean' ||
        typeof input === 'bigint') {
        return String(input);
    }
    if (typeof input === 'symbol') {
        return input.description ? `Symbol(${input.description})` : 'Symbol()';
    }
    try {
        const json = JSON.stringify(input);
        return typeof json === 'string'
            ? json
            : (0, node_util_1.inspect)(input, { depth: 6, maxArrayLength: 50 });
    }
    catch {
        return (0, node_util_1.inspect)(input, { depth: 6, maxArrayLength: 50 });
    }
}
function addServerLog(params) {
    const msg = normalizeMessage(params.message).trim();
    const stack = normalizeMessage(params.stack).trim();
    const combined = stack ? (msg ? `${msg}\n${stack}` : stack) : msg;
    if (!combined)
        return;
    const contextRaw = typeof params.context === 'string' ? params.context.trim() : '';
    const context = contextRaw ? contextRaw : null;
    if (params.level !== 'error' &&
        context &&
        IGNORED_CONTEXTS.has(context) &&
        params.level !== 'warn') {
        return;
    }
    ring[writeIndex] = {
        id: nextId++,
        time: new Date().toISOString(),
        level: params.level,
        message: combined.length > 10_000 ? `${combined.slice(0, 10_000)}…` : combined,
        context,
    };
    writeIndex = (writeIndex + 1) % MAX_ENTRIES;
    count = Math.min(MAX_ENTRIES, count + 1);
}
function listServerLogs(params) {
    const latestId = nextId - 1;
    const limit = Math.max(1, Math.min(MAX_ENTRIES, params?.limit ?? 200));
    const afterId = params?.afterId ?? null;
    if (!count)
        return { logs: [], latestId };
    const oldestIndex = count === MAX_ENTRIES ? writeIndex : 0;
    const ordered = [];
    for (let i = 0; i < count; i++) {
        const idx = (oldestIndex + i) % MAX_ENTRIES;
        const entry = ring[idx];
        if (entry)
            ordered.push(entry);
    }
    const filtered = afterId === null ? ordered : ordered.filter((l) => l.id > afterId);
    return { logs: filtered.slice(-limit), latestId };
}
//# sourceMappingURL=server-logs.store.js.map