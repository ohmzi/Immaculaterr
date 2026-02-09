"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureBootstrapEnv = ensureBootstrapEnv;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
function parseUmask(raw) {
    const v = raw?.trim();
    if (!v)
        return null;
    let s = v.toLowerCase();
    if (s.startsWith('0o'))
        s = s.slice(2);
    if (!/^[0-7]{1,4}$/.test(s))
        return null;
    return Number.parseInt(s, 8);
}
async function tightenModeNoWorldAccess(path) {
    try {
        const mode = (await (0, promises_1.stat)(path)).mode & 0o777;
        const tightened = mode & 0o770;
        if (tightened !== mode) {
            await (0, promises_1.chmod)(path, tightened);
        }
    }
    catch {
    }
}
async function tightenFileTo600(path) {
    try {
        await (0, promises_1.chmod)(path, 0o600);
    }
    catch {
    }
}
async function ensureBootstrapEnv() {
    const repoRoot = (0, node_path_1.join)(__dirname, '..', '..', '..');
    const desiredUmask = parseUmask(process.env.APP_UMASK) ?? 0o077;
    try {
        process.umask(desiredUmask);
    }
    catch {
    }
    const dataDir = process.env.APP_DATA_DIR?.trim() || (0, node_path_1.join)(repoRoot, 'data');
    process.env.APP_DATA_DIR = dataDir;
    await (0, promises_1.mkdir)(dataDir, { recursive: true });
    await tightenModeNoWorldAccess(dataDir);
    const databaseUrl = process.env.DATABASE_URL?.trim() || `file:${(0, node_path_1.join)(dataDir, 'tcp.sqlite')}`;
    process.env.DATABASE_URL = databaseUrl;
    if (databaseUrl.startsWith('file:')) {
        const dbPath = databaseUrl.slice('file:'.length);
        await tightenFileTo600(dbPath);
    }
    return { repoRoot, dataDir, databaseUrl };
}
//# sourceMappingURL=bootstrap-env.js.map