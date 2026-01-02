import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type BootstrapEnv = {
  repoRoot: string;
  dataDir: string;
  databaseUrl: string;
};

export async function ensureBootstrapEnv(): Promise<BootstrapEnv> {
  const repoRoot = join(__dirname, '..', '..', '..');

  const dataDir = process.env.APP_DATA_DIR?.trim() || join(repoRoot, 'data');
  process.env.APP_DATA_DIR = dataDir;
  await mkdir(dataDir, { recursive: true });

  const databaseUrl =
    process.env.DATABASE_URL?.trim() || `file:${join(dataDir, 'tcp.sqlite')}`;
  process.env.DATABASE_URL = databaseUrl;

  return { repoRoot, dataDir, databaseUrl };
}


