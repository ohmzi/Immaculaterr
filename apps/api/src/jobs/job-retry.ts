import type { JobContext, JsonObject } from './jobs.types';

export type JobRetryOptions = {
  label: string;
  ctx?: JobContext;
  meta?: JsonObject;
  attempts?: number;
  delayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errToMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

export async function withJobRetry<T>(
  fn: () => Promise<T>,
  options: JobRetryOptions,
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 10_000;
  const label = options.label;
  const ctx = options.ctx;
  const meta = options.meta ?? {};

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const error = errToMessage(err);

      if (attempt < attempts) {
        if (ctx) {
          await ctx.warn(`${label}: failed (attempt ${attempt}/${attempts}) — retrying`, {
            attempt,
            attempts,
            delayMs,
            error,
            ...meta,
          });
        }
        await sleep(delayMs);
        continue;
      }

      if (ctx) {
        await ctx.warn(`${label}: failed after ${attempts} attempts`, {
          attempt,
          attempts,
          error,
          ...meta,
        });
      }
      throw err;
    }
  }

  // Unreachable, but keeps TS happy.
  throw lastErr instanceof Error ? lastErr : new Error(errToMessage(lastErr));
}

export async function withJobRetryOrNull<T>(
  fn: () => Promise<T>,
  options: JobRetryOptions,
): Promise<T | null> {
  try {
    return await withJobRetry(fn, options);
  } catch {
    return null;
  }
}

