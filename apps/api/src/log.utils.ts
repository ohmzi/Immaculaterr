/**
 * Shared logging utilities — safe stringification, truncation, URL/PII sanitization.
 *
 * Centralizes helpers that were previously duplicated across multiple service files.
 */

import {
  LOG_BODY_MAX_LENGTH,
  LOG_ERROR_MESSAGE_MAX_LENGTH,
} from './app.constants';

const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'key',
  'secret',
  'password',
  'auth',
  'apikey',
  'api_key',
  'x-plex-token',
  'authtoken',
  'auth_token',
  'plextoken',
  'plex_token',
  'access_token',
]);

const PLEX_TOKEN_PARAMS = [
  'X-Plex-Token',
  'x-plex-token',
  'token',
  'authToken',
  'auth_token',
  'plexToken',
  'plex_token',
];

export function errToMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

export function truncateForLog(
  value: string,
  max: number = LOG_BODY_MAX_LENGTH,
): string {
  const s = value.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function sanitizeUrlForLogs(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    for (const k of PLEX_TOKEN_PARAMS) {
      if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

export function sanitizePathForLog(originalUrl: string): string {
  const qIdx = originalUrl.indexOf('?');
  if (qIdx === -1) return originalUrl;

  const path = originalUrl.slice(0, qIdx);
  try {
    const params = new URLSearchParams(originalUrl.slice(qIdx + 1));
    for (const key of [...params.keys()]) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        params.set(key, 'REDACTED');
      }
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  } catch {
    return path;
  }
}

export function maskUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length <= 2) return '***';
  return `${trimmed.slice(0, 2)}***`;
}

export function maskIp(ip: string | null): string {
  if (!ip) return '***';
  const trimmed = ip.trim();
  if (!trimmed) return '***';

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length >= 8) {
      return `${parts.slice(0, 4).join(':')}:*:*:*:*`;
    }
    return trimmed.replace(/:[^:]+$/, ':*');
  }

  const octets = trimmed.split('.');
  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.*.*`;
  }
  return '***';
}

export function truncateErrorMessage(err: unknown): string {
  return truncateForLog(errToMessage(err), LOG_ERROR_MESSAGE_MAX_LENGTH);
}
