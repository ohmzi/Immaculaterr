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

// How much of a non-JSON error body we are willing to put in front of a user.
// Bodies that reach this path are written for operators, not for a toast.
const MAX_ERROR_TEXT_LENGTH = 200;

// Gateway/timeout statuses arrive from Cloudflare or a reverse proxy rather
// than from our API, so there is no `message` field to lean on — say what
// happened instead of showing the proxy's own error page.
const STATUS_MESSAGES: Record<number, string> = {
  408: 'The request timed out.',
  413: 'That upload is too large.',
  429: 'Too many requests — please wait a moment.',
  502: 'The server could not be reached (bad gateway).',
  503: 'The server is temporarily unavailable.',
  504: 'The server took too long to respond.',
  520: 'The server returned an unexpected response.',
  521: 'The server is down.',
  522: 'The connection to the server timed out.',
  524: 'The server took too long to respond.',
};

function statusMessage(status: number): string {
  return STATUS_MESSAGES[status] ?? `HTTP ${status}`;
}

function looksLikeMarkup(text: string): boolean {
  return /^\s*(<!doctype|<html|<\?xml|<head|<body)/i.test(text);
}

/**
 * Turn a non-JSON error body into something worth showing a user. An edge
 * proxy answers a timeout with a full HTML page; interpolating that into a
 * toast dumped the entire document on screen, so markup is dropped outright
 * and anything else is collapsed to a single capped line.
 */
function readableErrorText(text: string, status: number): string {
  const trimmed = text.trim();
  if (!trimmed || looksLikeMarkup(trimmed)) return statusMessage(status);

  const collapsed = trimmed.replace(/\s+/g, ' ');
  if (collapsed.length <= MAX_ERROR_TEXT_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_ERROR_TEXT_LENGTH).trimEnd()}…`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function readApiError(res: Response) {
  const contentType = res.headers.get('content-type') ?? '';
  // Read once as text: `res.json()` would consume the body and leave nothing
  // to fall back on when the response is not the JSON it claimed to be.
  const text = await res.text().catch(() => '');

  // Matches application/json as well as problem+json and vendor variants.
  if (contentType.includes('json')) {
    const body = parseJson(text);
    if (body && typeof body === 'object') {
      const maybeMessage = (body as Record<string, unknown>)['message'];
      if (typeof maybeMessage === 'string') return { message: maybeMessage, body };
      if (Array.isArray(maybeMessage)) return { message: maybeMessage.join('; '), body };
      return { message: statusMessage(res.status), body };
    }
    return { message: readableErrorText(text, res.status), body: body ?? text };
  }

  return { message: readableErrorText(text, res.status), body: text };
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


