import { readFileSync } from 'node:fs';

type EnvLike = Record<string, string | undefined>;

function normalizeFileSecret(raw: string): string {
  // Preserve intentional newlines (for PEM, etc.) while stripping one trailing newline.
  return raw.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

export function applyFileBackedEnv(env: EnvLike = process.env): void {
  for (const [key, value] of Object.entries(env)) {
    if (!key.endsWith('_FILE')) continue;
    const targetKey = key.slice(0, -'_FILE'.length);
    if (!targetKey) continue;

    const targetExisting = env[targetKey];
    if (typeof targetExisting === 'string' && targetExisting.trim() !== '') {
      continue;
    }

    const filePath = typeof value === 'string' ? value.trim() : '';
    if (!filePath) continue;

    try {
      const raw = readFileSync(filePath, 'utf8');
      env[targetKey] = normalizeFileSecret(raw);
    } catch {
      // Best-effort only. Individual consumers should validate required secrets.
    }
  }
}
