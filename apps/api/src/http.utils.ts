/**
 * Shared HTTP resilience helpers for the integration clients.
 *
 * A single transient upstream hiccup (429/502/503/504, connection reset,
 * DNS blip, or our own timeout) should not fail a whole job run, so
 * idempotent requests get exactly one delayed retry.
 */

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const DEFAULT_RETRY_DELAY_MS = 750;
const MAX_RETRY_AFTER_MS = 3_000;

export function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_HTTP_STATUSES.has(status);
}

export function isTransientNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ((err as Error).name === 'AbortError') return true;
  const seen = new Set<unknown>();
  let cursor: unknown = err;
  while (cursor && typeof cursor === 'object' && !seen.has(cursor)) {
    seen.add(cursor);
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)) {
      return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayFromResponse(res: Response): number {
  const retryAfter = res.headers.get('retry-after');
  const seconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1000));
  }
  return DEFAULT_RETRY_DELAY_MS;
}

/**
 * Runs `doFetch` and retries once when the response status or thrown error
 * looks transient. Only use for idempotent requests (GET-style reads).
 */
export async function fetchWithTransientRetry(
  doFetch: () => Promise<Response>,
): Promise<Response> {
  try {
    const res = await doFetch();
    if (!isTransientHttpStatus(res.status)) return res;
    const delay = retryDelayFromResponse(res);
    // Consume the body so the aborted attempt does not leak the socket.
    await res.text().catch(() => undefined);
    await sleep(delay);
    return await doFetch();
  } catch (err) {
    if (!isTransientNetworkError(err)) throw err;
    await sleep(DEFAULT_RETRY_DELAY_MS);
    return await doFetch();
  }
}
