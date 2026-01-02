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
    return { message: JSON.stringify(body), body };
  }

  const text = await res.text().catch(() => '');
  return { message: text || `HTTP ${res.status}`, body: text };
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    const { message, body } = await readApiError(res);
    throw new ApiError(res.status, message, body);
  }
  return (await res.json()) as T;
}


