import { chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { applyFileBackedEnv } from './security/secret-source';

export type BootstrapEnv = {
  repoRoot: string;
  dataDir: string;
  databaseUrl: string;
};

function parseUmask(raw: string | undefined): number | null {
  const v = raw?.trim();
  if (!v) return null;
  let s = v.toLowerCase();
  if (s.startsWith('0o')) s = s.slice(2);
  // Support "77" / "077" / "0077"
  if (!/^[0-7]{1,4}$/.test(s)) return null;
  return Number.parseInt(s, 8);
}

async function tightenModeNoWorldAccess(path: string) {
  try {
    const mode = (await stat(path)).mode & 0o777;
    // Remove "other" (world) perms, leave owner/group unchanged.
    const tightened = mode & 0o770;
    if (tightened !== mode) {
      await chmod(path, tightened);
    }
  } catch {
    // best-effort only
  }
}

async function tightenFileTo600(path: string) {
  try {
    await chmod(path, 0o600);
  } catch {
    // best-effort only
  }
}

export async function ensureBootstrapEnv(): Promise<BootstrapEnv> {
  // Support Docker/Kubernetes-style env var indirection (e.g. APP_MASTER_KEY_FILE).
  applyFileBackedEnv(process.env);

  const repoRoot = join(__dirname, '..', '..', '..');

  // Harden default permissions for newly created files (SQLite DB, master key, etc.).
  // Can be overridden for special deployments by setting APP_UMASK (octal).
  const desiredUmask = parseUmask(process.env.APP_UMASK) ?? 0o077;
  try {
    process.umask(desiredUmask);
  } catch {
    // ignore on platforms where umask isn't supported
  }

  const dataDir = process.env.APP_DATA_DIR?.trim() || join(repoRoot, 'data');
  process.env.APP_DATA_DIR = dataDir;
  await mkdir(dataDir, { recursive: true });
  // Best-effort hardening: ensure the data directory isn't world-accessible.
  await tightenModeNoWorldAccess(dataDir);

  const databaseUrl =
    process.env.DATABASE_URL?.trim() || `file:${join(dataDir, 'tcp.sqlite')}`;
  process.env.DATABASE_URL = databaseUrl;

  // Best-effort hardening for file-based DB URLs.
  if (databaseUrl.startsWith('file:')) {
    const dbPath = databaseUrl.slice('file:'.length);
    await tightenFileTo600(dbPath);
  }

  return { repoRoot, dataDir, databaseUrl };
}
