export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function readApiError(res: Response) {
  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body = (await res.json().catch(() => null)) as unknown;
    if (body && typeof body === 'object') {
      const maybeMessage = (body as Record<string, unknown>)['message'];
      if (typeof maybeMessage === 'string') return { message: maybeMessage, body };
      if (Array.isArray(maybeMessage)) return { message: maybeMessage.join('; '), body };
    }
    return { message: `HTTP ${res.status}`, body };
  }

  const text = await res.text().catch(() => '');
  return { message: text || `HTTP ${res.status}`, body: text };
}

const RATE_LIMIT_RETRY_CAP_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const doFetch = () =>
    fetch(input, {
      credentials: 'include',
      ...init,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...init?.headers,
      },
    });

  let res = await doFetch();

  // A momentary 429 on an idempotent read gets one polite retry after the
  // server's Retry-After (capped), instead of erroring the whole screen.
  const method = (init?.method ?? 'GET').toUpperCase();
  if (res.status === 429 && method === 'GET') {
    const retryAfterSec = Number.parseFloat(res.headers.get('Retry-After') ?? '');
    const delayMs = Math.min(
      RATE_LIMIT_RETRY_CAP_MS,
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : 1_000,
    );
    await sleep(delayMs);
    res = await doFetch();
  }

  if (!res.ok) {
    const { message, body } = await readApiError(res);
    throw new ApiError(res.status, message, body);
  }
  return (await res.json()) as T;
}


