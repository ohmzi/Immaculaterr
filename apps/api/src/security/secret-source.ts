import { readFileSync } from 'node:fs';

type EnvLike = Record<string, string | undefined>;

function normalizeFileSecret(raw: string): string {
  // Preserve intentional newlines (for PEM, etc.) while stripping one trailing newline.
  return raw.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

function resolveTargetKey(fileBackedKey: string): string | null {
  if (!fileBackedKey.endsWith('_FILE')) return null;
  const targetKey = fileBackedKey.slice(0, -'_FILE'.length);
  return targetKey || null;
}

function hasConfiguredValue(env: EnvLike, key: string): boolean {
  const existingValue = env[key];
  return typeof existingValue === 'string' && existingValue.trim() !== '';
}

function resolveFilePath(raw: string | undefined): string | null {
  const filePath = typeof raw === 'string' ? raw.trim() : '';
  return filePath || null;
}

function applyFileBackedEnvEntry(
  env: EnvLike,
  fileBackedKey: string,
  value: string | undefined,
): void {
  const targetKey = resolveTargetKey(fileBackedKey);
  if (!targetKey || hasConfiguredValue(env, targetKey)) return;
  const filePath = resolveFilePath(value);
  if (!filePath) return;

  try {
    const raw = readFileSync(filePath, 'utf8');
    env[targetKey] = normalizeFileSecret(raw);
  } catch {
    // Best-effort only. Individual consumers should validate required secrets.
  }
}

export function applyFileBackedEnv(env: EnvLike = process.env): void {
  for (const [key, value] of Object.entries(env)) {
    applyFileBackedEnvEntry(env, key, value);
  }
}
