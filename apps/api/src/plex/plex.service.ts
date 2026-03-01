import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import { PlexPin, PlexSharedServerUser } from './plex.types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  allowBooleanAttributes: true,
  processEntities: false,
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
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBoolSafe(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === '1' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'on'
    );
  }
  return false;
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
  const hasIdentity = ['userID', 'userId', 'accountId', 'accountID', 'id'].some(
    (k) => k in obj,
  );
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

type PlexServerConnectionCandidate = {
  uri: string;
  local: boolean;
  relay: boolean;
  owned: boolean;
  publicAddressMatches: boolean;
};

function hasServerProvides(value: unknown): boolean {
  const raw = toStringSafe(value).toLowerCase();
  if (!raw) return false;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes('server');
}

function collectServerResourceObjects(
  value: unknown,
  out: Record<string, unknown>[],
  depth = 0,
) {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectServerResourceObjects(item, out, depth + 1);
    }
    return;
  }
  if (!isPlainObject(value)) return;

  if (hasServerProvides(value['provides'])) {
    out.push(value);
  }

  for (const next of Object.values(value)) {
    collectServerResourceObjects(next, out, depth + 1);
  }
}

function appendConnectionObjects(
  source: unknown,
  out: Record<string, unknown>[],
): void {
  if (Array.isArray(source)) {
    for (const entry of source) {
      if (isPlainObject(entry)) out.push(entry);
    }
    return;
  }
  if (!isPlainObject(source)) return;

  const nested = source['Connection'] ?? source['connection'];
  if (nested !== undefined) {
    appendConnectionObjects(nested, out);
    return;
  }

  out.push(source);
}

function parseServerConnectionCandidates(
  payload: unknown,
): PlexServerConnectionCandidate[] {
  const resources: Record<string, unknown>[] = [];
  collectServerResourceObjects(payload, resources, 0);

  const out: PlexServerConnectionCandidate[] = [];
  const seen = new Set<string>();

  for (const resource of resources) {
    const connections: Record<string, unknown>[] = [];
    appendConnectionObjects(resource['Connection'], connections);
    appendConnectionObjects(resource['connection'], connections);
    appendConnectionObjects(resource['connections'], connections);
    appendConnectionObjects(resource['Connections'], connections);

    const owned = toBoolSafe(resource['owned']);
    const publicAddressMatches = toBoolSafe(resource['publicAddressMatches']);

    for (const connection of connections) {
      const uri = toStringSafe(connection['uri'] ?? connection['URI']);
      if (!uri) continue;

      try {
        const parsed = new URL(uri);
        if (!/^https?:$/i.test(parsed.protocol)) continue;
      } catch {
        continue;
      }

      const dedupeKey = uri.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push({
        uri,
        local: toBoolSafe(connection['local'] ?? connection['isLocal']),
        relay: toBoolSafe(connection['relay']),
        owned,
        publicAddressMatches,
      });
    }
  }

  return out;
}

function isLikelyLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (host === 'host.docker.internal') return true;
  if (host === '127.0.0.1' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

function scoreServerConnectionCandidate(
  candidate: PlexServerConnectionCandidate,
): number {
  let score = 0;
  if (candidate.local) score += 100;
  if (!candidate.relay) score += 40;
  if (candidate.owned) score += 20;
  if (candidate.publicAddressMatches) score += 10;

  try {
    const parsed = new URL(candidate.uri);
    if (parsed.protocol === 'http:') score += 5;
    if (isLikelyLocalOrPrivateHost(parsed.hostname)) score += 8;
  } catch {
    // Ignore malformed URL scoring; parser already validated shape.
  }

  return score;
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
    let suggestedBaseUrl: string | null = null;
    let suggestedBaseUrls: string[] = [];
    if (data.authToken) {
      try {
        const suggested = await this.suggestPreferredServerBaseUrl({
          plexToken: data.authToken,
        });
        suggestedBaseUrl = suggested.suggestedBaseUrl;
        suggestedBaseUrls = suggested.suggestedBaseUrls;
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        this.logger.warn(
          `Unable to detect Plex server URL for authorized pin id=${data.id}: ${message}`,
        );
      }
    }
    return {
      id: data.id,
      authToken: data.authToken ?? null,
      expiresAt: data.expiresAt ?? null,
      suggestedBaseUrl,
      suggestedBaseUrls,
    };
  }

  async suggestPreferredServerBaseUrl(params: { plexToken: string }): Promise<{
    suggestedBaseUrl: string | null;
    suggestedBaseUrls: string[];
  }> {
    const plexToken = params.plexToken.trim();
    if (!plexToken) {
      return { suggestedBaseUrl: null, suggestedBaseUrls: [] };
    }

    const lookup = await this.fetchServerConnectionsFromEndpoints({
      plexToken,
      endpoints: [
        'https://plex.tv/api/resources?includeHttps=1&includeRelay=1',
        'https://plex.tv/pms/resources?includeHttps=1&includeRelay=1',
      ],
    });

    if (!lookup.ok || !lookup.candidates.length) {
      return { suggestedBaseUrl: null, suggestedBaseUrls: [] };
    }

    const sorted = lookup.candidates
      .slice()
      .sort((left, right) => {
        const scoreDelta =
          scoreServerConnectionCandidate(right) -
          scoreServerConnectionCandidate(left);
        if (scoreDelta !== 0) return scoreDelta;
        return left.uri.localeCompare(right.uri);
      })
      .map((candidate) => candidate.uri);

    return {
      suggestedBaseUrl: sorted[0] ?? null,
      suggestedBaseUrls: sorted,
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

    const reason =
      [...sharedLookup.errors, ...homeLookup.errors].join(' | ') || 'unknown';
    throw new BadGatewayException(
      `Plex shared users lookup failed for machineIdentifier=${machineIdentifier}: ${reason}`,
    );
  }

  private async fetchUsersFromEndpoints(params: {
    plexToken: string;
    endpoints: string[];
    parser: (payload: unknown) => PlexSharedServerUser[];
  }): Promise<{
    ok: boolean;
    users: PlexSharedServerUser[];
    errors: string[];
  }> {
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

        this.logger.log(
          `Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`,
        );

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

  private async fetchServerConnectionsFromEndpoints(params: {
    plexToken: string;
    endpoints: string[];
  }): Promise<{
    ok: boolean;
    candidates: PlexServerConnectionCandidate[];
    errors: string[];
  }> {
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

        this.logger.log(
          `Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`,
        );

        const body = raw.trim();
        if (!body) return { ok: true, candidates: [], errors };

        const contentType = res.headers.get('content-type') ?? '';
        const looksJson = body.startsWith('{') || body.startsWith('[');
        const looksXml = body.startsWith('<');

        let parsed: unknown = null;
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

        return {
          ok: true,
          candidates: parseServerConnectionCandidates(parsed),
          errors,
        };
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        errors.push(`${safeUrl}: ${message}`);
      }
    }

    return { ok: false, candidates: [], errors };
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
