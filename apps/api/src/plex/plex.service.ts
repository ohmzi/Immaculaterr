import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import { PlexPin, PlexSharedServerUser } from './plex.types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  allowBooleanAttributes: true,
});

function sanitizeUrlForLogs(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    for (const k of [
      'X-Plex-Token',
      'x-plex-token',
      'token',
      'authToken',
      'auth_token',
      'plexToken',
      'plex_token',
    ]) {
      if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringSafe(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value))
    return String(Math.trunc(value));
  return '';
}

function toIntSafe(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function hasUserLikeKey(obj: Record<string, unknown>): boolean {
  return [
    'username',
    'userName',
    'email',
    'invitedEmail',
    'userID',
    'userId',
    'invitedID',
    'invitedId',
    'accountId',
    'accountID',
  ].some((k) => k in obj);
}

function hasHomeUserLikeKey(obj: Record<string, unknown>): boolean {
  const hasIdentity = [
    'userID',
    'userId',
    'accountId',
    'accountID',
    'id',
  ].some((k) => k in obj);
  const hasDisplay = [
    'friendlyName',
    'title',
    'name',
    'username',
    'userName',
    'email',
  ].some((k) => k in obj);
  return hasIdentity && hasDisplay;
}

type UserCandidatePredicate = (obj: Record<string, unknown>) => boolean;

function collectCandidateUserObjects(
  value: unknown,
  out: Record<string, unknown>[],
  predicate: UserCandidatePredicate,
  depth = 0,
) {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCandidateUserObjects(item, out, predicate, depth + 1);
    }
    return;
  }
  if (!isPlainObject(value)) return;

  if (predicate(value)) {
    out.push(value);
  }

  for (const next of Object.values(value)) {
    collectCandidateUserObjects(next, out, predicate, depth + 1);
  }
}

function normalizeSharedServerUser(
  raw: Record<string, unknown>,
): PlexSharedServerUser | null {
  const nestedUser = isPlainObject(raw['user']) ? raw['user'] : null;
  const plexAccountId =
    toIntSafe(raw['userID']) ??
    toIntSafe(raw['userId']) ??
    toIntSafe(raw['accountId']) ??
    toIntSafe(raw['accountID']) ??
    toIntSafe(raw['invitedID']) ??
    toIntSafe(raw['invitedId']) ??
    (nestedUser ? toIntSafe(nestedUser['id']) : null) ??
    (nestedUser ? toIntSafe(nestedUser['accountId']) : null) ??
    (nestedUser ? toIntSafe(nestedUser['accountID']) : null) ??
    (nestedUser ? toIntSafe(nestedUser['userID']) : null) ??
    (nestedUser ? toIntSafe(nestedUser['userId']) : null) ??
    toIntSafe(raw['id']) ??
    null;

  const username =
    toStringSafe(raw['username']) ||
    toStringSafe(raw['userName']) ||
    (nestedUser ? toStringSafe(nestedUser['username']) : '') ||
    null;
  const email =
    toStringSafe(raw['email']) ||
    toStringSafe(raw['invitedEmail']) ||
    (nestedUser ? toStringSafe(nestedUser['email']) : '') ||
    null;
  const nestedUserTitle = nestedUser ? toStringSafe(nestedUser['title']) : '';
  const nestedUserFriendlyName = nestedUser
    ? toStringSafe(nestedUser['friendlyName'])
    : '';
  const nestedUserName = nestedUser ? toStringSafe(nestedUser['name']) : '';
  const rawFriendlyName = toStringSafe(raw['friendlyName']);
  const rawName = toStringSafe(raw['name']);
  const rawTitle = toStringSafe(raw['title']);
  const plexAccountTitle =
    nestedUserFriendlyName ||
    nestedUserTitle ||
    nestedUserName ||
    username ||
    rawFriendlyName ||
    rawName ||
    rawTitle ||
    email ||
    null;

  if (!plexAccountTitle && plexAccountId === null) return null;

  return {
    plexAccountId,
    plexAccountTitle,
    username,
    email,
  };
}

function dedupeSharedServerUsers(
  users: PlexSharedServerUser[],
): PlexSharedServerUser[] {
  const out: PlexSharedServerUser[] = [];
  const seen = new Set<string>();
  for (const user of users) {
    const titleKey = (user.plexAccountTitle ?? '').trim().toLowerCase();
    const usernameKey = (user.username ?? '').trim().toLowerCase();
    const emailKey = (user.email ?? '').trim().toLowerCase();
    const key =
      user.plexAccountId !== null
        ? `id:${user.plexAccountId}`
        : titleKey
          ? `title:${titleKey}`
          : usernameKey
            ? `username:${usernameKey}`
            : emailKey
              ? `email:${emailKey}`
              : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(user);
  }
  return out;
}

function parseSharedUsersPayload(payload: unknown): PlexSharedServerUser[] {
  const candidates: Record<string, unknown>[] = [];
  collectCandidateUserObjects(payload, candidates, hasUserLikeKey, 0);
  const normalized = candidates
    .map((row) => normalizeSharedServerUser(row))
    .filter((row): row is PlexSharedServerUser => Boolean(row));
  return dedupeSharedServerUsers(normalized);
}

function parseHomeUsersPayload(payload: unknown): PlexSharedServerUser[] {
  const candidates: Record<string, unknown>[] = [];
  collectCandidateUserObjects(payload, candidates, hasHomeUserLikeKey, 0);
  const normalized = candidates
    .map((row) => normalizeSharedServerUser(row))
    .filter((row): row is PlexSharedServerUser => Boolean(row));
  return dedupeSharedServerUsers(normalized);
}

@Injectable()
export class PlexService {
  private readonly logger = new Logger(PlexService.name);
  private readonly clientIdentifier: string;

  constructor() {
    // Plex expects this identifier to be consistent while polling a PIN.
    // We’ll persist it once we add DB-backed settings.
    this.clientIdentifier = process.env.PLEX_CLIENT_IDENTIFIER ?? randomUUID();
  }

  async createPin() {
    // strong=true creates a PIN that generates a permanent (non-expiring) auth token
    // The PIN itself expires in ~30 minutes, but the resulting auth token never expires
    const url = 'https://plex.tv/api/v2/pins?strong=true';
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    const res = await fetch(url, {
      method: 'POST',
      headers: this.getPlexHeaders(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const ms = Date.now() - startedAt;
      this.logger.warn(
        `Plex.tv HTTP POST ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
      );
      throw new BadGatewayException(
        `Plex PIN create failed: HTTP ${res.status} ${body}`.trim(),
      );
    }

    const data = (await res.json()) as PlexPin;
    const ms = Date.now() - startedAt;
    this.logger.log(`Plex.tv HTTP POST ${safeUrl} -> ${res.status} (${ms}ms)`);
    this.logger.log(`Created Plex PIN id=${data.id}`);

    // Plex OAuth-style page (NOT plex.tv/link which is the 4-character “Link Account” flow).
    const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(
      this.clientIdentifier,
    )}&code=${encodeURIComponent(data.code)}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(
      'Immaculaterr',
    )}`;

    return {
      id: data.id,
      expiresAt: data.expiresAt ?? null,
      authUrl,
      clientIdentifier: this.clientIdentifier,
    };
  }

  async checkPin(pinId: number) {
    const url = `https://plex.tv/api/v2/pins/${pinId}`;
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    const res = await fetch(url, {
      method: 'GET',
      headers: this.getPlexHeaders(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const ms = Date.now() - startedAt;
      this.logger.warn(
        `Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
      );
      throw new BadGatewayException(
        `Plex PIN check failed: HTTP ${res.status} ${body}`.trim(),
      );
    }

    const data = (await res.json()) as PlexPin;
    const ms = Date.now() - startedAt;
    this.logger.log(`Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);
    if (data.authToken) {
      this.logger.log(`Plex PIN authorized id=${data.id}`);
    }
    return {
      id: data.id,
      authToken: data.authToken ?? null,
      expiresAt: data.expiresAt ?? null,
    };
  }

  async whoami(plexToken: string) {
    const url = 'https://plex.tv/api/v2/user';
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...this.getPlexHeaders(),
        'X-Plex-Token': plexToken,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const ms = Date.now() - startedAt;
      this.logger.warn(
        `Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
      );
      throw new BadGatewayException(
        `Plex whoami failed: HTTP ${res.status} ${body}`.trim(),
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const ms = Date.now() - startedAt;
    this.logger.log(`Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);

    // Return a minimal, non-sensitive subset for diagnostics.
    return {
      id: data['id'] ?? null,
      uuid: data['uuid'] ?? null,
      username: data['username'] ?? null,
      title: data['title'] ?? null,
    };
  }

  async listSharedUsersForServer(params: {
    plexToken: string;
    machineIdentifier: string;
  }): Promise<PlexSharedServerUser[]> {
    const plexToken = params.plexToken.trim();
    const machineIdentifier = params.machineIdentifier.trim();
    if (!plexToken || !machineIdentifier) return [];

    const sharedLookup = await this.fetchUsersFromEndpoints({
      plexToken,
      endpoints: [
        `https://plex.tv/api/servers/${encodeURIComponent(machineIdentifier)}/shared_servers`,
        `https://plex.tv/api/v2/servers/${encodeURIComponent(machineIdentifier)}/shared_servers`,
      ],
      parser: parseSharedUsersPayload,
    });
    const homeLookup = await this.fetchUsersFromEndpoints({
      plexToken,
      endpoints: [
        'https://plex.tv/api/v2/home/users',
        'https://plex.tv/api/home/users',
      ],
      parser: parseHomeUsersPayload,
    });

    const mergedUsers = dedupeSharedServerUsers([
      ...sharedLookup.users,
      ...homeLookup.users,
    ]);
    if (mergedUsers.length) return mergedUsers;
    if (sharedLookup.ok || homeLookup.ok) return [];

    const reason = [...sharedLookup.errors, ...homeLookup.errors].join(' | ') || 'unknown';
    throw new BadGatewayException(
      `Plex shared users lookup failed for machineIdentifier=${machineIdentifier}: ${reason}`,
    );
  }

  private async fetchUsersFromEndpoints(params: {
    plexToken: string;
    endpoints: string[];
    parser: (payload: unknown) => PlexSharedServerUser[];
  }): Promise<{ ok: boolean; users: PlexSharedServerUser[]; errors: string[] }> {
    const errors: string[] = [];
    for (const url of params.endpoints) {
      const safeUrl = sanitizeUrlForLogs(url);
      const startedAt = Date.now();
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            ...this.getPlexHeaders(),
            Accept: 'application/json, text/xml;q=0.9, application/xml;q=0.8',
            'X-Plex-Token': params.plexToken,
          },
        });

        const raw = await res.text().catch(() => '');
        const ms = Date.now() - startedAt;

        if (!res.ok) {
          this.logger.warn(
            `Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${raw}`.trim(),
          );
          errors.push(`HTTP ${res.status} ${safeUrl}`);
          continue;
        }

        this.logger.log(`Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);

        const body = raw.trim();
        if (!body) return { ok: true, users: [], errors };

        const contentType = res.headers.get('content-type') ?? '';
        let parsed: unknown = null;

        const looksJson = body.startsWith('{') || body.startsWith('[');
        const looksXml = body.startsWith('<');

        if (contentType.includes('json') || looksJson) {
          try {
            parsed = JSON.parse(body) as unknown;
          } catch {
            parsed = null;
          }
        }
        if ((contentType.includes('xml') || looksXml) && parsed === null) {
          try {
            parsed = xmlParser.parse(body) as unknown;
          } catch {
            parsed = null;
          }
        }
        if (parsed === null) {
          // Last chance: try both parsers in opposite order.
          try {
            parsed = xmlParser.parse(body) as unknown;
          } catch {
            try {
              parsed = JSON.parse(body) as unknown;
            } catch {
              parsed = null;
            }
          }
        }

        if (parsed === null) {
          errors.push(`unparseable payload ${safeUrl}`);
          continue;
        }

        return { ok: true, users: params.parser(parsed), errors };
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        errors.push(`${safeUrl}: ${msg}`);
      }
    }

    return { ok: false, users: [], errors };
  }

  private getPlexHeaders(): Record<string, string> {
    // https://support.plex.tv/articles/plex-api/
    return {
      Accept: 'application/json',
      'X-Plex-Client-Identifier': this.clientIdentifier,
      'X-Plex-Product': 'Immaculaterr',
      'X-Plex-Version': '0.0.0',
      'X-Plex-Device': 'Server',
      'X-Plex-Device-Name': 'Immaculaterr',
      'X-Plex-Platform': 'Web',
      'X-Plex-Platform-Version': process.version,
    };
  }
}
