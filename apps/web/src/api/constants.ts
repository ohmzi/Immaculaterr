export const API_PREFIX = '/api';
export const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export function apiPath(path: `/${string}`): string {
  return `${API_PREFIX}${path}`;
}

export function toQuerySuffix(searchParams: URLSearchParams): string {
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}
