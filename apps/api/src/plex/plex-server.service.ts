import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { normalizeCollectionTitle } from './plex-collections.utils';

type PlexSection = {
  key: string;
  title: string;
  type?: string;
};

type PlexMetadata = Record<string, unknown> & {
  ratingKey?: string;
  title?: string;
  year?: number | string;
  addedAt?: number | string;
  Guid?: unknown;
  Media?: unknown;
  parentIndex?: number | string;
  index?: number | string;
  type?: string;
};

type PlexXml = {
  MediaContainer?: Record<string, unknown>;
};

export type PlexMediaPart = {
  id: string | null;
  key: string | null;
  file: string | null;
  size: number | null;
};

export type PlexMediaVersion = {
  id: string | null;
  videoResolution: string | null;
  parts: PlexMediaPart[];
};

export type PlexMetadataDetails = {
  ratingKey: string;
  title: string;
  type: string | null;
  year: number | null;
  addedAt: number | null;
  librarySectionId: string | null;
  librarySectionTitle: string | null;
  grandparentTitle: string | null;
  grandparentRatingKey: string | null;
  parentIndex: number | null;
  index: number | null;
  tmdbIds: number[];
  tvdbIds: number[];
  media: PlexMediaVersion[];
};

export type PlexActivityDetails = {
  uuid: string;
  type: string | null;
  title: string | null;
  subtitle: string | null;
  progress: number | null;
  cancellable: boolean | null;
  userId: number | null;
  librarySectionId: string | null;
};

export type PlexNowPlayingSession = {
  sessionKey: string;
  type: 'movie' | 'episode' | 'track' | 'unknown';
  ratingKey: string | null;

  title: string | null;
  year: number | null;

  // TV-only fields (for episodes)
  grandparentTitle: string | null;
  grandparentRatingKey: string | null;
  parentIndex: number | null; // season number
  index: number | null; // episode number

  librarySectionId: number | null;
  librarySectionTitle: string | null;

  viewOffsetMs: number | null;
  durationMs: number | null;

  // Best-effort user identity from Plex session XML
  userTitle: string | null;
  userId: number | null;
};

export type PlexRecentlyAddedItem = {
  type: string | null;
  ratingKey: string;
  title: string | null;
  year: number | null;
  addedAt: number | null;
  updatedAt: number | null;
  librarySectionId: number | null;
  librarySectionTitle: string | null;
  grandparentTitle: string | null;
  grandparentRatingKey: string | null;
  parentTitle: string | null;
  parentRatingKey: string | null;
  parentIndex: number | null;
  index: number | null;
};

type PlexDirectory = Record<string, unknown> & {
  key?: unknown;
  title?: unknown;
  type?: unknown;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  allowBooleanAttributes: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asUnknownArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asPlexMetadataArray(
  container: Record<string, unknown> | undefined,
): PlexMetadata[] {
  // Plex can return items under different element names depending on endpoint.
  // IMPORTANT: some endpoints return mixed nodes (e.g. both Video + Directory). We want all of them.
  const items = [
    ...asUnknownArray(container?.Metadata),
    ...asUnknownArray(container?.Video),
    ...asUnknownArray(container?.Directory),
    ...asUnknownArray(container?.Track),
  ].filter((v): v is PlexMetadata => Boolean(v) && typeof v === 'object');

  return items;
}

function asPlexSessionItemArray(
  container: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
  // /status/sessions returns current sessions under:
  // - MediaContainer.Video
  // - MediaContainer.Track
  // Some servers may return Metadata/Directory-like nodes; be defensive.
  const items = (container?.Video ??
    container?.Track ??
    container?.Metadata ??
    container?.Directory ??
    []) as unknown;
  return asUnknownArray(items).filter(
    (v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object',
  );
}

function toStringSafe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

function asPlexXml(value: unknown): PlexXml {
  return value && typeof value === 'object' ? (value as PlexXml) : {};
}

function asPlexMediaArray(value: unknown): Array<Record<string, unknown>> {
  return asUnknownArray(value).filter(
    (v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object',
  );
}

function asPlexPartArray(value: unknown): Array<Record<string, unknown>> {
  return asUnknownArray(value).filter(
    (v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object',
  );
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function sanitizeUrlForLogs(raw: string): string {
  try {
    const u = new URL(raw);
    // Never log credentials if someone configured baseUrl as http(s)://user:pass@host
    u.username = '';
    u.password = '';

    // Defensive: if any token-like query params appear, redact them.
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

function extractFirstInt(value: string): number | null {
  const match = value.match(/(\d{2,})/);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

function extractIdFromGuid(id: string, kind: 'tmdb' | 'tvdb'): number | null {
  // Python script approach: look for 'tmdb' or 'tvdb' anywhere in the string (case-insensitive)
  const lower = id.toLowerCase();
  const searchTerm = kind === 'tmdb' ? 'tmdb' : 'tvdb';

  if (!lower.includes(searchTerm)) {
    return null;
  }

  if (kind === 'tmdb') {
    // Radarr Python script: guid.id.split('//')[-1]
    // Split by '//' and take the last part
    const parts = id.split('//');
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1];
      // Remove query parameters and path segments, then extract integer
      const clean = lastPart.split('?')[0].split('&')[0].split('/')[0];
      const n = Number.parseInt(clean, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    // Fallback: try to extract first integer from the whole string
    const fallback = extractFirstInt(id);
    if (fallback) return fallback;
  } else {
    // Sonarr Python script: re.search(r"(\d+)", guid_id) - find first number
    // Match Python's get_tvdb_id_from_plex_series logic
    const match = id.match(/(\d+)/);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  return null;
}

function extractIdsFromGuids(
  guidNode: unknown,
  kind: 'tmdb' | 'tvdb',
): number[] {
  const guids = asUnknownArray(guidNode);
  const ids: number[] = [];

  for (const g of guids) {
    if (!g || typeof g !== 'object') continue;
    // Plex XML GUIDs can be structured as { id: "..." } or just a string
    // Try 'id' property first (most common)
    let idValue: string | undefined;
    if ('id' in g) {
      const idProp = (g as Record<string, unknown>)['id'];
      if (typeof idProp === 'string') {
        idValue = idProp;
      }
    }
    // If no 'id' property, try using the object itself as a string (some XML parsers do this)
    if (!idValue && typeof g === 'string') {
      idValue = g;
    }
    // If still no value, try '#text' (some XML parsers put text content there)
    if (!idValue && '#text' in g) {
      const textProp = (g as Record<string, unknown>)['#text'];
      if (typeof textProp === 'string') {
        idValue = textProp;
      }
    }

    if (!idValue) continue;

    const parsed = extractIdFromGuid(idValue, kind);
    if (parsed) ids.push(parsed);
  }

  return ids;
}

@Injectable()
export class PlexServerService {
  private readonly logger = new Logger(PlexServerService.name);

  async getMachineIdentifier(params: {
    baseUrl: string;
    token: string;
  }): Promise<string> {
    const { baseUrl, token } = params;
    const url = new URL('identity', normalizeBaseUrl(baseUrl)).toString();
    const xml = asPlexXml(await this.fetchXml(url, token, 10000));
    const machineId = toStringSafe(
      xml.MediaContainer?.machineIdentifier,
    ).trim();
    if (!machineId) {
      throw new BadGatewayException(
        'Failed to read Plex machineIdentifier from /identity',
      );
    }
    return machineId;
  }

  async listActivities(params: {
    baseUrl: string;
    token: string;
  }): Promise<PlexActivityDetails[]> {
    const { baseUrl, token } = params;
    const url = new URL('activities', normalizeBaseUrl(baseUrl)).toString();
    const xml = asPlexXml(await this.fetchXml(url, token, 15000));
    const container = xml.MediaContainer;
    if (!container) return [];

    const activityNodes = asUnknownArray(
      (container as Record<string, unknown>)['Activity'] ?? [],
    ).filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object');

    const out: PlexActivityDetails[] = [];

    for (const node of activityNodes) {
      const uuid = toStringSafe(node['uuid']).trim();
      if (!uuid) continue;

      const type = (() => {
        const s = toStringSafe(node['type']).trim();
        return s ? s : null;
      })();
      const title = (() => {
        const s = toStringSafe(node['title']).trim();
        return s ? s : null;
      })();
      const subtitle = (() => {
        const s = toStringSafe(node['subtitle']).trim();
        return s ? s : null;
      })();
      const progress = (() => {
        const raw = node['progress'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        if (typeof raw === 'string' && raw.trim()) {
          const n = Number.parseFloat(raw.trim());
          return Number.isFinite(n) ? n : null;
        }
        return null;
      })();
      const cancellable = (() => {
        const raw = node['cancellable'];
        if (typeof raw === 'boolean') return raw;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw !== 0;
        if (typeof raw === 'string' && raw.trim()) {
          const s = raw.trim().toLowerCase();
          if (s === '1' || s === 'true') return true;
          if (s === '0' || s === 'false') return false;
        }
        return null;
      })();
      const userId = (() => {
        const raw = node['userID'];
        if (typeof raw === 'number' && Number.isFinite(raw))
          return Math.trunc(raw);
        if (typeof raw === 'string' && raw.trim()) {
          const n = Number.parseInt(raw.trim(), 10);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      })();
      const librarySectionId = (() => {
        const ctx = node['Context'];
        // Plex returns <Context librarySectionID="3" />
        if (!ctx || typeof ctx !== 'object') return null;
        const v = toStringSafe((ctx as Record<string, unknown>)['librarySectionID']).trim();
        return v ? v : null;
      })();

      out.push({
        uuid,
        type,
        title,
        subtitle,
        progress,
        cancellable,
        userId,
        librarySectionId,
      });
    }

    return out;
  }

  async listNowPlayingSessions(params: {
    baseUrl: string;
    token: string;
  }): Promise<PlexNowPlayingSession[]> {
    const { baseUrl, token } = params;
    const url = new URL('status/sessions', normalizeBaseUrl(baseUrl)).toString();
    const xml = asPlexXml(await this.fetchXml(url, token, 15000));
    const container = xml.MediaContainer;
    if (!container) return [];

    const items = asPlexSessionItemArray(container);
    const out: PlexNowPlayingSession[] = [];

    for (const it of items) {
      const rawSessionKey = toStringSafe(it['sessionKey']).trim();
      const sessionKey = rawSessionKey || toStringSafe(it['session']).trim();
      if (!sessionKey) continue;

      const rawType = toStringSafe(it['type']).trim().toLowerCase();
      const type: PlexNowPlayingSession['type'] =
        rawType === 'movie'
          ? 'movie'
          : rawType === 'episode'
            ? 'episode'
            : rawType === 'track'
              ? 'track'
              : 'unknown';

      const ratingKey = (() => {
        const s = toStringSafe(it['ratingKey']).trim();
        return s ? s : null;
      })();

      const title = (() => {
        const s = toStringSafe(it['title']).trim();
        return s ? s : null;
      })();

      const year = (() => {
        const raw = it['year'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();

      const grandparentTitle = (() => {
        const s = toStringSafe(it['grandparentTitle']).trim();
        return s ? s : null;
      })();
      const grandparentRatingKey = (() => {
        const s = toStringSafe(it['grandparentRatingKey']).trim();
        return s ? s : null;
      })();
      const parentIndex = (() => {
        const raw = it['parentIndex'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();
      const index = (() => {
        const raw = it['index'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();

      const librarySectionId = (() => {
        const raw = it['librarySectionID'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();
      const librarySectionTitle = (() => {
        const s = toStringSafe(it['librarySectionTitle']).trim();
        return s ? s : null;
      })();

      const viewOffsetMs = (() => {
        const raw = it['viewOffset'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? Math.max(0, n) : null;
      })();
      const durationMs = (() => {
        const raw = it['duration'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? Math.max(0, n) : null;
      })();

      // Best-effort user info (Plex includes <User title="..."> in some session payloads)
      const userTitle = (() => {
        const user = it['User'];
        if (!user || typeof user !== 'object') return null;
        const s = toStringSafe((user as Record<string, unknown>)['title']).trim();
        return s ? s : null;
      })();
      const userId = (() => {
        const user = it['User'];
        if (!user || typeof user !== 'object') return null;
        const raw = (user as Record<string, unknown>)['id'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();

      out.push({
        sessionKey,
        type,
        ratingKey,
        title,
        year,
        grandparentTitle,
        grandparentRatingKey,
        parentIndex,
        index,
        librarySectionId,
        librarySectionTitle,
        viewOffsetMs,
        durationMs,
        userTitle,
        userId,
      });
    }

    return out;
  }

  async listRecentlyAdded(params: {
    baseUrl: string;
    token: string;
    take?: number;
  }): Promise<PlexRecentlyAddedItem[]> {
    const { baseUrl, token } = params;
    const take = Number.isFinite(params.take ?? NaN) ? (params.take as number) : 50;

    const u = new URL('library/recentlyAdded', normalizeBaseUrl(baseUrl));
    // Plex uses these query params for pagination.
    u.searchParams.set('X-Plex-Container-Start', '0');
    u.searchParams.set('X-Plex-Container-Size', String(Math.max(1, Math.min(200, take))));
    const url = u.toString();

    const xml = asPlexXml(await this.fetchXml(url, token, 15000));
    const container = xml.MediaContainer;
    if (!container) return [];

    const items = asPlexMetadataArray(container);
    const out: PlexRecentlyAddedItem[] = [];

    for (const it of items) {
      const ratingKey = toStringSafe(it.ratingKey).trim();
      if (!ratingKey) continue;

      const type = (() => {
        const s = toStringSafe(it.type).trim();
        return s ? s : null;
      })();

      const title = (() => {
        const s = toStringSafe(it.title).trim();
        return s ? s : null;
      })();

      const year = (() => {
        const raw = it.year;
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();

      const addedAt = (() => {
        const raw = it.addedAt;
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();
      const updatedAt = (() => {
        const raw = (it as Record<string, unknown>)['updatedAt'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();

      const librarySectionId = (() => {
        const raw = (it as Record<string, unknown>)['librarySectionID'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();
      const librarySectionTitle = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['librarySectionTitle'],
        ).trim();
        return s ? s : null;
      })();

      const grandparentTitle = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['grandparentTitle'],
        ).trim();
        return s ? s : null;
      })();
      const grandparentRatingKey = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['grandparentRatingKey'],
        ).trim();
        return s ? s : null;
      })();
      const parentTitle = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['parentTitle'],
        ).trim();
        return s ? s : null;
      })();
      const parentRatingKey = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['parentRatingKey'],
        ).trim();
        return s ? s : null;
      })();

      const parentIndex = (() => {
        const raw = it.parentIndex;
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();
      const index = (() => {
        const raw = it.index;
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();

      out.push({
        type,
        ratingKey,
        title,
        year,
        addedAt,
        updatedAt,
        librarySectionId,
        librarySectionTitle,
        grandparentTitle,
        grandparentRatingKey,
        parentTitle,
        parentRatingKey,
        parentIndex,
        index,
      });
    }

    return out;
  }

  async listRecentlyAddedForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    take?: number;
  }): Promise<PlexRecentlyAddedItem[]> {
    const { baseUrl, token, librarySectionKey } = params;
    const take = Number.isFinite(params.take ?? NaN) ? (params.take as number) : 50;

    const u = new URL(
      `library/sections/${encodeURIComponent(librarySectionKey)}/recentlyAdded`,
      normalizeBaseUrl(baseUrl),
    );
    // Plex uses these query params for pagination.
    u.searchParams.set('X-Plex-Container-Start', '0');
    u.searchParams.set('X-Plex-Container-Size', String(Math.max(1, Math.min(200, take))));
    const url = u.toString();

    const xml = asPlexXml(await this.fetchXml(url, token, 15000));
    const container = xml.MediaContainer;
    if (!container) return [];

    const items = asPlexMetadataArray(container);
    const out: PlexRecentlyAddedItem[] = [];

    for (const it of items) {
      const ratingKey = toStringSafe(it.ratingKey).trim();
      if (!ratingKey) continue;

      const type = (() => {
        const s = toStringSafe(it.type).trim();
        return s ? s : null;
      })();

      const title = (() => {
        const s = toStringSafe(it.title).trim();
        return s ? s : null;
      })();

      const year = (() => {
        const raw = it.year;
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();

      const addedAt = (() => {
        const raw = it.addedAt;
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();
      const updatedAt = (() => {
        const raw = (it as Record<string, unknown>)['updatedAt'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();

      const librarySectionId = (() => {
        const raw = (it as Record<string, unknown>)['librarySectionID'];
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();
      const librarySectionTitle = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['librarySectionTitle'],
        ).trim();
        return s ? s : null;
      })();

      const grandparentTitle = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['grandparentTitle'],
        ).trim();
        return s ? s : null;
      })();
      const grandparentRatingKey = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['grandparentRatingKey'],
        ).trim();
        return s ? s : null;
      })();
      const parentTitle = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['parentTitle'],
        ).trim();
        return s ? s : null;
      })();
      const parentRatingKey = (() => {
        const s = toStringSafe(
          (it as Record<string, unknown>)['parentRatingKey'],
        ).trim();
        return s ? s : null;
      })();

      const parentIndex = (() => {
        const raw = it.parentIndex;
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();
      const index = (() => {
        const raw = it.index;
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
        const s = toStringSafe(raw).trim();
        if (!s) return null;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : null;
      })();

      out.push({
        type,
        ratingKey,
        title,
        year,
        addedAt,
        updatedAt,
        librarySectionId,
        librarySectionTitle,
        grandparentTitle,
        grandparentRatingKey,
        parentTitle,
        parentRatingKey,
        parentIndex,
        index,
      });
    }

    return out;
  }

  async getMetadataDetails(params: {
    baseUrl: string;
    token: string;
    ratingKey: string;
  }): Promise<PlexMetadataDetails | null> {
    const { baseUrl, token, ratingKey } = params;
    const rk = ratingKey.trim();
    if (!rk) return null;

    const url = new URL(
      `library/metadata/${encodeURIComponent(rk)}`,
      normalizeBaseUrl(baseUrl),
    );
    // Include GUIDs for tmdb/tvdb extraction (needed for Radarr/Sonarr mapping).
    url.searchParams.set('includeGuids', '1');

    const xml = asPlexXml(await this.fetchXml(url.toString(), token, 20000));
    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);
    const item = items[0];
    if (!item) return null;

    const title = typeof item.title === 'string' ? item.title : '';
    const type = typeof item.type === 'string' ? item.type : null;
    const librarySectionId = (() => {
      const raw = (item as Record<string, unknown>)['librarySectionID'];
      const s = toStringSafe(raw).trim();
      return s ? s : null;
    })();
    const librarySectionTitle = (() => {
      const raw = (item as Record<string, unknown>)['librarySectionTitle'];
      if (typeof raw !== 'string') return null;
      const s = raw.trim();
      return s ? s : null;
    })();
    const grandparentTitle = (() => {
      const raw = (item as Record<string, unknown>)['grandparentTitle'];
      if (typeof raw !== 'string') return null;
      const s = raw.trim();
      return s ? s : null;
    })();
    const grandparentRatingKey = (() => {
      const raw = (item as Record<string, unknown>)['grandparentRatingKey'];
      const s = toStringSafe(raw).trim();
      return s ? s : null;
    })();
    const year =
      typeof (item as Record<string, unknown>)['year'] === 'number'
        ? ((item as Record<string, unknown>)['year'] as number)
        : (() => {
            const raw = (item as Record<string, unknown>)['year'];
            if (typeof raw === 'string' && raw.trim()) {
              const n = Number.parseInt(raw.trim(), 10);
              return Number.isFinite(n) ? n : null;
            }
            return null;
          })();

    const addedAtRaw = item.addedAt;
    const addedAt =
      typeof addedAtRaw === 'number'
        ? Number.isFinite(addedAtRaw)
          ? addedAtRaw
          : null
        : typeof addedAtRaw === 'string' && addedAtRaw.trim()
          ? (() => {
              const n = Number.parseInt(addedAtRaw.trim(), 10);
              return Number.isFinite(n) ? n : null;
            })()
          : null;

    const parentIndexRaw = item.parentIndex;
    const parentIndex =
      typeof parentIndexRaw === 'number'
        ? Number.isFinite(parentIndexRaw)
          ? parentIndexRaw
          : null
        : typeof parentIndexRaw === 'string' && parentIndexRaw.trim()
          ? (() => {
              const n = Number.parseInt(parentIndexRaw.trim(), 10);
              return Number.isFinite(n) ? n : null;
            })()
          : null;

    const indexRaw = item.index;
    const index =
      typeof indexRaw === 'number'
        ? Number.isFinite(indexRaw)
          ? indexRaw
          : null
        : typeof indexRaw === 'string' && indexRaw.trim()
          ? (() => {
              const n = Number.parseInt(indexRaw.trim(), 10);
              return Number.isFinite(n) ? n : null;
            })()
          : null;

    const tmdbIds = extractIdsFromGuids(item.Guid, 'tmdb');
    const tvdbIds = extractIdsFromGuids(item.Guid, 'tvdb');

    const media = asPlexMediaArray(item.Media).map((m) => {
      const mediaId = toStringSafe(m['id']).trim() || null;
      const videoResolution = toStringSafe(m['videoResolution']).trim() || null;
      const parts = asPlexPartArray(m['Part']).map((p) => ({
        id: toStringSafe(p['id']).trim() || null,
        key: toStringSafe(p['key']).trim() || null,
        file: toStringSafe(p['file']).trim() || null,
        size: (() => {
          const raw = p['size'];
          if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
          if (typeof raw === 'string' && raw.trim()) {
            const n = Number.parseInt(raw.trim(), 10);
            return Number.isFinite(n) ? n : null;
          }
          return null;
        })(),
      }));
      return { id: mediaId, videoResolution, parts };
    });

    const out: PlexMetadataDetails = {
      ratingKey: rk,
      title,
      type,
      year,
      addedAt,
      librarySectionId,
      librarySectionTitle,
      grandparentTitle,
      grandparentRatingKey,
      parentIndex,
      index,
      tmdbIds,
      tvdbIds,
      media,
    };

    return out;
  }

  async deletePartByKey(params: {
    baseUrl: string;
    token: string;
    partKey: string;
  }): Promise<void> {
    const { baseUrl, token, partKey } = params;
    const key = partKey.trim();
    if (!key) {
      throw new Error('partKey is required');
    }

    const toUrl = (pathOrUrl: string) => {
      if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
      const normalized = pathOrUrl.startsWith('/')
        ? pathOrUrl.slice(1)
        : pathOrUrl;
      return new URL(normalized, normalizeBaseUrl(baseUrl)).toString();
    };

    const attemptUrls: string[] = [];
    attemptUrls.push(toUrl(key));

    // Fallback: if the part key includes /library/parts/<id>/..., try /library/parts/<id>
    const match = key.match(/\/library\/parts\/(\d+)/i);
    if (match?.[1]) {
      attemptUrls.push(toUrl(`library/parts/${match[1]}`));
    }

    let lastErr: unknown = null;
    for (const u of attemptUrls) {
      try {
        await this.fetchNoContent(u, token, 'DELETE', 30000);
        return;
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async deleteMediaVersion(params: {
    baseUrl: string;
    token: string;
    ratingKey: string;
    mediaId: string;
  }): Promise<void> {
    const { baseUrl, token, ratingKey, mediaId } = params;
    const rk = ratingKey.trim();
    const mid = mediaId.trim();
    if (!rk) throw new Error('ratingKey is required');
    if (!mid) throw new Error('mediaId is required');

    // Plex supports deleting a specific media version under a metadata item:
    // DELETE /library/metadata/<ratingKey>/media/<mediaId>
    const url = new URL(
      `library/metadata/${encodeURIComponent(rk)}/media/${encodeURIComponent(mid)}`,
      normalizeBaseUrl(baseUrl),
    ).toString();
    await this.fetchNoContent(url, token, 'DELETE', 30000);
  }

  async deleteMetadataByRatingKey(params: {
    baseUrl: string;
    token: string;
    ratingKey: string;
  }): Promise<void> {
    const { baseUrl, token, ratingKey } = params;
    const rk = ratingKey.trim();
    if (!rk) throw new Error('ratingKey is required');
    const url = new URL(
      `library/metadata/${encodeURIComponent(rk)}`,
      normalizeBaseUrl(baseUrl),
    ).toString();
    await this.fetchNoContent(url, token, 'DELETE', 30000);
  }

  async findMovieRatingKeyByTitle(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    title: string;
  }): Promise<{ ratingKey: string; title: string } | null> {
    const { baseUrl, token, librarySectionKey, title } = params;
    const q = title.trim();
    if (!q) return null;

    // Ensure librarySectionKey is in the expected safe format (numeric ID) to
    // prevent path manipulation or SSRF-style issues when constructing URLs.
    // Plex library section IDs are numeric, so reject anything else.
    if (!/^[1-9]\d*$/.test(librarySectionKey.trim())) {
      this.logger.warn(
        `Ignoring invalid Plex librarySectionKey: ${librarySectionKey}`,
      );
      return null;
    }

    const url = new URL(
      `library/sections/${librarySectionKey}/search?type=1&query=${encodeURIComponent(q)}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    const xml = asPlexXml(await this.fetchXml(url, token, 20000));
    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);

    if (!items.length) return null;

    // Prefer exact title match, fall back to first result.
    const exact = items.find(
      (m) =>
        typeof m.title === 'string' &&
        m.title.toLowerCase() === q.toLowerCase(),
    );
    const best = exact ?? items[0];
    const ratingKey = best.ratingKey ? String(best.ratingKey) : '';
    const bestTitle = typeof best.title === 'string' ? best.title : q;
    if (!ratingKey) return null;
    return { ratingKey, title: bestTitle };
  }

  async findShowRatingKeyByTitle(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    title: string;
  }): Promise<{ ratingKey: string; title: string } | null> {
    const { baseUrl, token, librarySectionKey, title } = params;
    const q = title.trim();
    if (!q) return null;

    const url = new URL(
      `library/sections/${librarySectionKey}/search?type=2&query=${encodeURIComponent(q)}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    const xml = asPlexXml(await this.fetchXml(url, token, 20000));
    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);

    if (!items.length) return null;

    const exact = items.find(
      (m) =>
        typeof m.title === 'string' &&
        m.title.toLowerCase() === q.toLowerCase(),
    );
    const best = exact ?? items[0];
    const ratingKey = best.ratingKey ? String(best.ratingKey) : '';
    const bestTitle = typeof best.title === 'string' ? best.title : q;
    if (!ratingKey) return null;
    return { ratingKey, title: bestTitle };
  }

  async getSections(params: {
    baseUrl: string;
    token: string;
  }): Promise<PlexSection[]> {
    const { baseUrl, token } = params;
    const url = new URL(
      'library/sections',
      normalizeBaseUrl(baseUrl),
    ).toString();
    const xml = asPlexXml(await this.fetchXml(url, token, 20000));

    const container = xml.MediaContainer;
    const dirs = asArray(
      (container?.Directory ?? []) as PlexDirectory | PlexDirectory[],
    );

    return dirs
      .map((d) => ({
        key: toStringSafe(d.key).trim(),
        title: toStringSafe(d.title).trim(),
        type: typeof d.type === 'string' ? d.type.trim() : undefined,
      }))
      .filter((d) => d.key && d.title);
  }

  async findSectionKeyByTitle(params: {
    baseUrl: string;
    token: string;
    title: string;
  }): Promise<string> {
    const { baseUrl, token, title } = params;
    const sections = await this.getSections({ baseUrl, token });
    const found = sections.find(
      (s) => s.title.toLowerCase() === title.toLowerCase(),
    );
    if (!found) {
      throw new BadGatewayException(`Plex library section not found: ${title}`);
    }
    return found.key;
  }

  async listMoviesWithTmdbIds(params: {
    baseUrl: string;
    token: string;
    movieLibraryName: string;
  }): Promise<
    Array<{
      ratingKey: string;
      title: string;
      tmdbId: number | null;
      addedAt: number | null;
      year: number | null;
    }>
  > {
    const { baseUrl, token, movieLibraryName } = params;
    const sectionKey = await this.findSectionKeyByTitle({
      baseUrl,
      token,
      title: movieLibraryName,
    });

    return await this.listMoviesWithTmdbIdsForSectionKey({
      baseUrl,
      token,
      librarySectionKey: sectionKey,
      sectionTitle: movieLibraryName,
    });
  }

  async listShowsWithTvdbIds(params: {
    baseUrl: string;
    token: string;
    tvLibraryName: string;
  }): Promise<
    Array<{
      ratingKey: string;
      title: string;
      tvdbId: number | null;
      addedAt: number | null;
      year: number | null;
    }>
  > {
    const { baseUrl, token, tvLibraryName } = params;
    const sectionKey = await this.findSectionKeyByTitle({
      baseUrl,
      token,
      title: tvLibraryName,
    });

    return await this.listShowsWithTvdbIdsForSectionKey({
      baseUrl,
      token,
      librarySectionKey: sectionKey,
      sectionTitle: tvLibraryName,
    });
  }

  async listMoviesWithTmdbIdsForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    sectionTitle?: string;
    duplicateOnly?: boolean;
  }): Promise<
    Array<{
      ratingKey: string;
      title: string;
      tmdbId: number | null;
      addedAt: number | null;
      year: number | null;
    }>
  > {
    const { baseUrl, token, librarySectionKey, duplicateOnly = false } = params;

    const items = await this.listSectionItems({
      baseUrl,
      token,
      librarySectionKey,
      type: 1,
      includeGuids: true,
      duplicate: duplicateOnly,
      timeoutMs: 60000,
    });

    const out: Array<{
      ratingKey: string;
      title: string;
      tmdbId: number | null;
      addedAt: number | null;
      year: number | null;
    }> = [];

    for (const it of items) {
      const rk = it.ratingKey ? String(it.ratingKey).trim() : '';
      if (!rk) continue;
      const title = typeof it.title === 'string' ? it.title : rk;
      const tmdbId = it.Guid
        ? (extractIdsFromGuids(it.Guid, 'tmdb')[0] ?? null)
        : null;
      const addedAt =
        typeof it.addedAt === 'number'
          ? Number.isFinite(it.addedAt)
            ? it.addedAt
            : null
          : typeof it.addedAt === 'string' && it.addedAt.trim()
            ? (() => {
                const n = Number.parseInt(it.addedAt.trim(), 10);
                return Number.isFinite(n) ? n : null;
              })()
            : null;
      const year =
        typeof it.year === 'number'
          ? Number.isFinite(it.year)
            ? it.year
            : null
          : typeof it.year === 'string' && it.year.trim()
            ? (() => {
                const n = Number.parseInt(it.year.trim(), 10);
                return Number.isFinite(n) ? n : null;
              })()
            : null;

      out.push({ ratingKey: rk, title, tmdbId, addedAt, year });
    }

    return out;
  }

  async listShowsWithTvdbIdsForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    sectionTitle?: string;
  }): Promise<
    Array<{
      ratingKey: string;
      title: string;
      tvdbId: number | null;
      addedAt: number | null;
      year: number | null;
    }>
  > {
    const { baseUrl, token, librarySectionKey } = params;

    const items = await this.listSectionItems({
      baseUrl,
      token,
      librarySectionKey,
      type: 2,
      includeGuids: true,
      duplicate: false,
      timeoutMs: 60000,
    });

    const out: Array<{
      ratingKey: string;
      title: string;
      tvdbId: number | null;
      addedAt: number | null;
      year: number | null;
    }> = [];

    for (const it of items) {
      const rk = it.ratingKey ? String(it.ratingKey).trim() : '';
      if (!rk) continue;
      const title = typeof it.title === 'string' ? it.title : rk;
      const tvdbId = it.Guid
        ? (extractIdsFromGuids(it.Guid, 'tvdb')[0] ?? null)
        : null;
      const addedAt =
        typeof it.addedAt === 'number'
          ? Number.isFinite(it.addedAt)
            ? it.addedAt
            : null
          : typeof it.addedAt === 'string' && it.addedAt.trim()
            ? (() => {
                const n = Number.parseInt(it.addedAt.trim(), 10);
                return Number.isFinite(n) ? n : null;
              })()
            : null;
      const year =
        typeof it.year === 'number'
          ? Number.isFinite(it.year)
            ? it.year
            : null
          : typeof it.year === 'string' && it.year.trim()
            ? (() => {
                const n = Number.parseInt(it.year.trim(), 10);
                return Number.isFinite(n) ? n : null;
              })()
            : null;

      out.push({ ratingKey: rk, title, tvdbId, addedAt, year });
    }

    if (params.sectionTitle) {
      this.logger.debug(
        `Plex TV list built section=${params.sectionTitle} items=${out.length}`,
      );
    }

    return out;
  }

  async getMovieRatingKeySetForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    sectionTitle?: string;
  }): Promise<Set<string>> {
    const { baseUrl, token, librarySectionKey, sectionTitle } = params;
    const items = await this.listSectionItems({
      baseUrl,
      token,
      librarySectionKey,
      type: 1,
      includeGuids: false,
      duplicate: false,
      timeoutMs: 60000,
    });

    const set = new Set<string>();
    for (const it of items) {
      const rk = it.ratingKey ? String(it.ratingKey).trim() : '';
      if (rk) set.add(rk);
    }

    this.logger.log(
      `Plex movie ratingKey set size=${set.size} section=${sectionTitle ?? librarySectionKey} items=${items.length}`,
    );

    return set;
  }

  async listDuplicateMovieRatingKeys(params: {
    baseUrl: string;
    token: string;
    movieLibraryName: string;
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    const { baseUrl, token, movieLibraryName } = params;
    const sectionKey = await this.findSectionKeyByTitle({
      baseUrl,
      token,
      title: movieLibraryName,
    });
    return await this.listDuplicateMovieRatingKeysForSectionKey({
      baseUrl,
      token,
      librarySectionKey: sectionKey,
    });
  }

  async listDuplicateMovieRatingKeysForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    const { baseUrl, token, librarySectionKey } = params;
    const items = await this.listSectionItems({
      baseUrl,
      token,
      librarySectionKey,
      type: 1,
      includeGuids: false,
      duplicate: true,
      timeoutMs: 60000,
    });
    return items
      .map((it) => ({
        ratingKey: it.ratingKey ? String(it.ratingKey).trim() : '',
        title: typeof it.title === 'string' ? it.title : '',
      }))
      .filter((it) => it.ratingKey && it.title);
  }

  async listTvShows(params: {
    baseUrl: string;
    token: string;
    tvLibraryName: string;
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    const { baseUrl, token, tvLibraryName } = params;
    const sectionKey = await this.findSectionKeyByTitle({
      baseUrl,
      token,
      title: tvLibraryName,
    });
    return await this.listTvShowsForSectionKey({
      baseUrl,
      token,
      librarySectionKey: sectionKey,
    });
  }

  async listTvShowsForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    const { baseUrl, token, librarySectionKey } = params;
    const items = await this.listSectionItems({
      baseUrl,
      token,
      librarySectionKey,
      type: 2,
      includeGuids: false,
      duplicate: false,
      timeoutMs: 60000,
    });
    return items
      .map((it) => ({
        ratingKey: it.ratingKey ? String(it.ratingKey).trim() : '',
        title: typeof it.title === 'string' ? it.title : '',
      }))
      .filter((it) => it.ratingKey && it.title);
  }

  async listDuplicateEpisodeRatingKeys(params: {
    baseUrl: string;
    token: string;
    tvLibraryName: string;
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    const { baseUrl, token, tvLibraryName } = params;
    const sectionKey = await this.findSectionKeyByTitle({
      baseUrl,
      token,
      title: tvLibraryName,
    });
    return await this.listDuplicateEpisodeRatingKeysForSectionKey({
      baseUrl,
      token,
      librarySectionKey: sectionKey,
    });
  }

  async listDuplicateEpisodeRatingKeysForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    const { baseUrl, token, librarySectionKey } = params;
    const items = await this.listSectionItems({
      baseUrl,
      token,
      librarySectionKey,
      type: 4,
      includeGuids: false,
      duplicate: true,
      timeoutMs: 60000,
    });
    return items
      .map((it) => ({
        ratingKey: it.ratingKey ? String(it.ratingKey).trim() : '',
        title: typeof it.title === 'string' ? it.title : '',
      }))
      .filter((it) => it.ratingKey && it.title);
  }

  async listEpisodesForShow(params: {
    baseUrl: string;
    token: string;
    showRatingKey: string;
    duplicateOnly?: boolean;
  }): Promise<
    Array<{
      ratingKey: string;
      title: string;
      seasonNumber: number | null;
      episodeNumber: number | null;
    }>
  > {
    const { baseUrl, token, showRatingKey, duplicateOnly = false } = params;
    const rk = showRatingKey.trim();
    if (!rk) return [];
    const url = new URL(
      `library/metadata/${encodeURIComponent(rk)}/allLeaves`,
      normalizeBaseUrl(baseUrl),
    );
    if (duplicateOnly) url.searchParams.set('duplicate', '1');
    const xml = asPlexXml(await this.fetchXml(url.toString(), token, 60000));
    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);
    return items
      .map((it) => ({
        ratingKey: it.ratingKey ? String(it.ratingKey).trim() : '',
        title: typeof it.title === 'string' ? it.title : '',
        seasonNumber: (() => {
          const raw = it.parentIndex;
          if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
          if (typeof raw === 'string' && raw.trim()) {
            const n = Number.parseInt(raw.trim(), 10);
            return Number.isFinite(n) ? n : null;
          }
          return null;
        })(),
        episodeNumber: (() => {
          const raw = it.index;
          if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
          if (typeof raw === 'string' && raw.trim()) {
            const n = Number.parseInt(raw.trim(), 10);
            return Number.isFinite(n) ? n : null;
          }
          return null;
        })(),
      }))
      .filter((it) => it.ratingKey && it.title);
  }

  async getAddedAtTimestampsForSection(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
  }): Promise<number[]> {
    const { baseUrl, token, librarySectionKey } = params;
    const url = new URL(
      `library/sections/${librarySectionKey}/all`,
      normalizeBaseUrl(baseUrl),
    ).toString();
    const xml = asPlexXml(await this.fetchXml(url, token, 60000));

    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);

    const out: number[] = [];
    for (const it of items) {
      const raw = it.addedAt;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        out.push(raw);
        continue;
      }
      if (typeof raw === 'string' && raw.trim()) {
        const n = Number.parseInt(raw.trim(), 10);
        if (Number.isFinite(n)) out.push(n);
      }
    }
    return out;
  }

  async getMovieTmdbIdSet(params: {
    baseUrl: string;
    token: string;
    movieLibraryName: string;
  }): Promise<Set<number>> {
    const { baseUrl, token, movieLibraryName } = params;
    const sectionKey = await this.findSectionKeyByTitle({
      baseUrl,
      token,
      title: movieLibraryName,
    });

    // Include GUIDs in the response (required to get TMDB IDs)
    const url = new URL(
      `library/sections/${sectionKey}/all`,
      normalizeBaseUrl(baseUrl),
    );
    url.searchParams.set('includeGuids', '1');
    const urlString = url.toString();
    const xml = asPlexXml(await this.fetchXml(urlString, token, 60000));

    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);

    const set = new Set<number>();
    let itemsWithGuids = 0;
    let itemsWithoutGuids = 0;
    let totalGuidsProcessed = 0;

    for (const item of items) {
      if (!item.Guid) {
        itemsWithoutGuids++;
        continue;
      }

      itemsWithGuids++;
      const ids = extractIdsFromGuids(item.Guid, 'tmdb');
      totalGuidsProcessed += ids.length;
      for (const id of ids) set.add(id);
    }

    this.logger.log(
      `Plex TMDB set size=${set.size} section=${movieLibraryName} items=${items.length} withGuids=${itemsWithGuids} withoutGuids=${itemsWithoutGuids} totalGuids=${totalGuidsProcessed}`,
    );

    // Log a sample of GUIDs for debugging
    if (items.length > 0 && items[0]?.Guid) {
      const sampleGuids = asUnknownArray(items[0].Guid).slice(0, 3);
      this.logger.debug(
        `Sample GUID structure: ${JSON.stringify(sampleGuids)}`,
      );
    }

    return set;
  }

  async getMovieTmdbIdSetForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    sectionTitle?: string;
  }): Promise<Set<number>> {
    const { baseUrl, token, librarySectionKey, sectionTitle } = params;
    const items = await this.listSectionItems({
      baseUrl,
      token,
      librarySectionKey,
      type: 1,
      includeGuids: true,
      duplicate: false,
      timeoutMs: 60000,
    });

    const set = new Set<number>();
    let itemsWithGuids = 0;
    let itemsWithoutGuids = 0;
    let totalGuidsProcessed = 0;

    for (const item of items) {
      if (!item.Guid) {
        itemsWithoutGuids++;
        continue;
      }

      itemsWithGuids++;
      const ids = extractIdsFromGuids(item.Guid, 'tmdb');
      totalGuidsProcessed += ids.length;
      for (const id of ids) set.add(id);
    }

    this.logger.log(
      `Plex TMDB set size=${set.size} section=${sectionTitle ?? librarySectionKey} items=${items.length} withGuids=${itemsWithGuids} withoutGuids=${itemsWithoutGuids} totalGuids=${totalGuidsProcessed}`,
    );

    if (items.length > 0 && items[0]?.Guid) {
      const sampleGuids = asUnknownArray(items[0].Guid).slice(0, 3);
      this.logger.debug(
        `Sample GUID structure: ${JSON.stringify(sampleGuids)}`,
      );
    }

    return set;
  }

  async getTvdbShowMap(params: {
    baseUrl: string;
    token: string;
    tvLibraryName: string;
  }): Promise<Map<number, string>> {
    const { baseUrl, token, tvLibraryName } = params;
    const sectionKey = await this.findSectionKeyByTitle({
      baseUrl,
      token,
      title: tvLibraryName,
    });

    // Include GUIDs in the response (required to get TVDB IDs)
    const url = new URL(
      `library/sections/${sectionKey}/all`,
      normalizeBaseUrl(baseUrl),
    );
    url.searchParams.set('includeGuids', '1');
    const urlString = url.toString();
    const xml = asPlexXml(await this.fetchXml(urlString, token, 60000));

    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);

    const map = new Map<number, string>();
    let itemsWithGuids = 0;
    let itemsWithoutGuids = 0;
    let totalGuidsProcessed = 0;
    let itemsWithTvdbIds = 0;
    let itemsWithoutTvdbIds = 0;

    for (const item of items) {
      const ratingKey = item.ratingKey ? String(item.ratingKey) : '';
      if (!ratingKey) continue;

      if (!item.Guid) {
        itemsWithoutGuids++;
        continue;
      }

      itemsWithGuids++;
      const ids = extractIdsFromGuids(item.Guid, 'tvdb');
      totalGuidsProcessed += ids.length;

      if (ids.length > 0) {
        itemsWithTvdbIds++;
        for (const id of ids) {
          if (!map.has(id)) map.set(id, ratingKey);
        }
      } else {
        itemsWithoutTvdbIds++;
      }
    }

    this.logger.log(
      `Plex TVDB map size=${map.size} section=${tvLibraryName} items=${items.length} withGuids=${itemsWithGuids} withoutGuids=${itemsWithoutGuids} withTvdbIds=${itemsWithTvdbIds} withoutTvdbIds=${itemsWithoutTvdbIds} totalGuids=${totalGuidsProcessed}`,
    );

    // Log a sample of GUIDs for debugging
    if (items.length > 0 && items[0]?.Guid) {
      const sampleGuids = asUnknownArray(items[0].Guid).slice(0, 3);
      this.logger.debug(
        `Sample GUID structure: ${JSON.stringify(sampleGuids)}`,
      );
    }

    return map;
  }

  async getTvdbShowMapForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    sectionTitle?: string;
  }): Promise<Map<number, string>> {
    const { baseUrl, token, librarySectionKey, sectionTitle } = params;
    const items = await this.listSectionItems({
      baseUrl,
      token,
      librarySectionKey,
      type: 2,
      includeGuids: true,
      duplicate: false,
      timeoutMs: 60000,
    });

    const map = new Map<number, string>();
    let itemsWithGuids = 0;
    let itemsWithoutGuids = 0;
    let totalGuidsProcessed = 0;
    let itemsWithTvdbIds = 0;
    let itemsWithoutTvdbIds = 0;

    for (const item of items) {
      const ratingKey = item.ratingKey ? String(item.ratingKey) : '';
      if (!ratingKey) continue;

      if (!item.Guid) {
        itemsWithoutGuids++;
        continue;
      }

      itemsWithGuids++;
      const ids = extractIdsFromGuids(item.Guid, 'tvdb');
      totalGuidsProcessed += ids.length;

      if (ids.length > 0) {
        itemsWithTvdbIds++;
        for (const id of ids) {
          if (!map.has(id)) map.set(id, ratingKey);
        }
      } else {
        itemsWithoutTvdbIds++;
      }
    }

    this.logger.log(
      `Plex TVDB map size=${map.size} section=${sectionTitle ?? librarySectionKey} items=${items.length} withGuids=${itemsWithGuids} withoutGuids=${itemsWithoutGuids} withTvdbIds=${itemsWithTvdbIds} withoutTvdbIds=${itemsWithoutTvdbIds} totalGuids=${totalGuidsProcessed}`,
    );

    if (items.length > 0 && items[0]?.Guid) {
      const sampleGuids = asUnknownArray(items[0].Guid).slice(0, 3);
      this.logger.debug(
        `Sample GUID structure: ${JSON.stringify(sampleGuids)}`,
      );
    }

    return map;
  }

  async getEpisodesSet(params: {
    baseUrl: string;
    token: string;
    showRatingKey: string;
  }): Promise<Set<string>> {
    const { baseUrl, token, showRatingKey } = params;
    const url = new URL(
      `library/metadata/${encodeURIComponent(showRatingKey)}/allLeaves`,
      normalizeBaseUrl(baseUrl),
    ).toString();
    const xml = asPlexXml(await this.fetchXml(url, token, 60000));

    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);

    const set = new Set<string>();
    for (const item of items) {
      const season = Number(item.parentIndex);
      const episode = Number(item.index);
      if (!Number.isFinite(season) || !Number.isFinite(episode)) continue;
      set.add(`${season}:${episode}`);
    }
    return set;
  }

  async findCollectionRatingKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    collectionName: string;
  }): Promise<string | null> {
    const { baseUrl, token, librarySectionKey, collectionName } = params;
    const target = normalizeCollectionTitle(collectionName);
    if (!target) return null;
    const url = new URL(
      `library/sections/${encodeURIComponent(
        librarySectionKey,
      )}/search?type=18&query=${encodeURIComponent(
        collectionName,
      )}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    const xml = asPlexXml(await this.fetchXml(url, token, 20000));
    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);

    for (const item of items) {
      const title = typeof item.title === 'string' ? item.title : '';
      if (!normalizeCollectionTitle(title)) continue;
      if (normalizeCollectionTitle(title) !== target) continue;
      const ratingKey = item.ratingKey ? String(item.ratingKey) : '';
      if (ratingKey) return ratingKey;
    }

    try {
      const fallbackItems = await this.listCollectionsForSectionKey({
        baseUrl,
        token,
        librarySectionKey,
        take: 400,
      });
      for (const item of fallbackItems) {
        if (!normalizeCollectionTitle(item.title)) continue;
        if (normalizeCollectionTitle(item.title) !== target) continue;
        if (item.ratingKey) return item.ratingKey;
      }
    } catch {
      // ignore fallback errors
    }

    return null;
  }

  async listCollectionsForSectionKey(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    take?: number;
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    const { baseUrl, token, librarySectionKey } = params;
    const take = Number.isFinite(params.take ?? NaN) ? (params.take as number) : 200;

    const fetchCollections = async (path: string) => {
      const url = new URL(path, normalizeBaseUrl(baseUrl));
      url.searchParams.set('X-Plex-Container-Start', '0');
      url.searchParams.set('X-Plex-Container-Size', String(Math.max(1, Math.min(500, take))));
      const xml = asPlexXml(await this.fetchXml(url.toString(), token, 20000));
      const container = xml.MediaContainer;
      const items = asPlexMetadataArray(container);
      return items
        .map((m) => ({
          ratingKey: m.ratingKey ? String(m.ratingKey) : '',
          title: typeof m.title === 'string' ? m.title : '',
        }))
        .filter((x) => x.ratingKey && x.title);
    };

    const primary = await fetchCollections(
      `library/sections/${encodeURIComponent(librarySectionKey)}/collections`,
    );
    if (primary.length > 0) return primary;

    return await fetchCollections(
      `library/sections/${encodeURIComponent(librarySectionKey)}/all?type=18`,
    );
  }

  async getCollectionItems(params: {
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
  }): Promise<Array<{ ratingKey: string; title: string }>> {
    const { baseUrl, token, collectionRatingKey } = params;
    const url = new URL(
      `library/metadata/${encodeURIComponent(collectionRatingKey)}/children`,
      normalizeBaseUrl(baseUrl),
    ).toString();
    const xml = asPlexXml(await this.fetchXml(url, token, 60000));

    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);
    return items
      .map((m) => ({
        ratingKey: m.ratingKey ? String(m.ratingKey) : '',
        title: typeof m.title === 'string' ? m.title : '',
      }))
      .filter((x) => x.ratingKey && x.title);
  }

  async setCollectionSort(params: {
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
    sort: 'release' | 'alpha' | 'custom';
  }) {
    const { baseUrl, token, collectionRatingKey, sort } = params;
    const sortMap: Record<'release' | 'alpha' | 'custom', number> = {
      release: 0,
      alpha: 1,
      custom: 2,
    };
    const sortValue = sortMap[sort];

    // PlexAPI uses: /library/metadata/<collectionRatingKey>/prefs?collectionSort=<0|1|2>
    const url = new URL(
      `library/metadata/${encodeURIComponent(collectionRatingKey)}/prefs`,
      normalizeBaseUrl(baseUrl),
    );
    url.searchParams.set('collectionSort', String(sortValue));
    await this.fetchNoContent(url.toString(), token, 'PUT', 20000);
  }

  async moveCollectionItem(params: {
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
    itemRatingKey: string;
    after?: string | null;
  }) {
    const { baseUrl, token, collectionRatingKey, itemRatingKey, after } =
      params;
    // Prefer /library/collections/... first (this works on many Plex servers and avoids noisy 404 fallbacks).
    const collectionsPath = after
      ? `library/collections/${encodeURIComponent(collectionRatingKey)}/items/${encodeURIComponent(
          itemRatingKey,
        )}/move?after=${encodeURIComponent(after)}`
      : `library/collections/${encodeURIComponent(collectionRatingKey)}/items/${encodeURIComponent(
          itemRatingKey,
        )}/move`;
    const collectionsUrl = new URL(
      collectionsPath,
      normalizeBaseUrl(baseUrl),
    ).toString();

    try {
      await this.fetchNoContent(collectionsUrl, token, 'PUT', 20000);
      return;
    } catch {
      // Fallback: some servers accept /library/metadata/... paths
      const metaPath = after
        ? `library/metadata/${encodeURIComponent(collectionRatingKey)}/items/${encodeURIComponent(
            itemRatingKey,
          )}/move?after=${encodeURIComponent(after)}`
        : `library/metadata/${encodeURIComponent(collectionRatingKey)}/items/${encodeURIComponent(
            itemRatingKey,
          )}/move`;
      const metaUrl = new URL(metaPath, normalizeBaseUrl(baseUrl)).toString();
      await this.fetchNoContent(metaUrl, token, 'PUT', 20000);
    }
  }

  async deleteCollection(params: {
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
  }) {
    const { baseUrl, token, collectionRatingKey } = params;
    const metaUrl = new URL(
      `library/metadata/${encodeURIComponent(collectionRatingKey)}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    try {
      await this.fetchNoContent(metaUrl, token, 'DELETE', 30000);
      return;
    } catch {
      // Fallback: some servers accept /library/collections/... paths
      const collectionsUrl = new URL(
        `library/collections/${encodeURIComponent(collectionRatingKey)}`,
        normalizeBaseUrl(baseUrl),
      ).toString();
      await this.fetchNoContent(collectionsUrl, token, 'DELETE', 30000);
    }
  }

  async createCollection(params: {
    baseUrl: string;
    token: string;
    machineIdentifier: string;
    librarySectionKey: string;
    collectionName: string;
    type: 1 | 2; // 1=movie, 2=show
    initialItemRatingKey?: string | null;
  }): Promise<string | null> {
    const {
      baseUrl,
      token,
      machineIdentifier,
      librarySectionKey,
      collectionName,
      type,
      initialItemRatingKey,
    } = params;

    const q = new URLSearchParams();
    q.set('type', String(type));
    q.set('title', collectionName);
    q.set('smart', '0');
    q.set('sectionId', librarySectionKey);

    if (initialItemRatingKey) {
      const uri = this.buildMetadataUri(
        machineIdentifier,
        initialItemRatingKey,
      );
      q.set('uri', uri);
    }

    const url = new URL(
      `library/collections?${q.toString()}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/xml',
          'X-Plex-Token': token,
        },
        signal: controller.signal,
      });
      const text = await res.text().catch(() => '');
      const ms = Date.now() - startedAt;

      if (!res.ok) {
        this.logger.warn(
          `Plex HTTP POST ${safeUrl} -> ${res.status} (${ms}ms) ${text}`.trim(),
        );
        throw new BadGatewayException(
          `Plex request failed: POST ${url} -> HTTP ${res.status} ${text}`.trim(),
        );
      }

      this.logger.debug(`Plex HTTP POST ${safeUrl} -> ${res.status} (${ms}ms)`);
      const location = res.headers.get('location');
      if (location) {
        const match = location.match(/metadata\/(\d+)/i);
        if (match?.[1]) return match[1];
      }
      if (!text) return null;

      try {
        const xml = asPlexXml(parser.parse(text) as unknown);
        const container = xml.MediaContainer;
        const items = asPlexMetadataArray(container);
        const first = items[0];
        const ratingKey = first?.ratingKey ? String(first.ratingKey).trim() : '';
        return ratingKey || null;
      } catch {
        return null;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async addItemToCollection(params: {
    baseUrl: string;
    token: string;
    machineIdentifier: string;
    collectionRatingKey: string;
    itemRatingKey: string;
  }) {
    const {
      baseUrl,
      token,
      machineIdentifier,
      collectionRatingKey,
      itemRatingKey,
    } = params;
    const uri = this.buildMetadataUri(machineIdentifier, itemRatingKey);

    // Prefer /library/collections/... first (this works on many Plex servers and avoids noisy 404 fallbacks).
    const collectionsUrl = new URL(
      `library/collections/${encodeURIComponent(collectionRatingKey)}/items`,
      normalizeBaseUrl(baseUrl),
    );
    collectionsUrl.searchParams.set('uri', uri);

    try {
      await this.fetchNoContent(collectionsUrl.toString(), token, 'PUT', 30000);
      return;
    } catch {
      // Fallback: some servers accept /library/metadata/... paths
      const metaUrl = new URL(
        `library/metadata/${encodeURIComponent(collectionRatingKey)}/items`,
        normalizeBaseUrl(baseUrl),
      );
      metaUrl.searchParams.set('uri', uri);
      await this.fetchNoContent(metaUrl.toString(), token, 'PUT', 30000);
    }
  }

  async removeItemFromCollection(params: {
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
    itemRatingKey: string;
  }) {
    const { baseUrl, token, collectionRatingKey, itemRatingKey } = params;
    const metaUrl = new URL(
      `library/metadata/${encodeURIComponent(collectionRatingKey)}/items/${encodeURIComponent(
        itemRatingKey,
      )}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    // Best-effort: Plex endpoints vary by server version.
    try {
      await this.fetchNoContent(metaUrl, token, 'DELETE', 30000);
    } catch {
      // Some servers accept PUT with ?remove=1 (metadata path)
      try {
        const fallback = `${metaUrl}?remove=1`;
        await this.fetchNoContent(fallback, token, 'PUT', 30000);
        return;
      } catch {
        // Fallback: try /library/collections/... paths
        const collectionsUrl = new URL(
          `library/collections/${encodeURIComponent(collectionRatingKey)}/items/${encodeURIComponent(
            itemRatingKey,
          )}`,
          normalizeBaseUrl(baseUrl),
        ).toString();
        try {
          await this.fetchNoContent(collectionsUrl, token, 'DELETE', 30000);
        } catch {
          const fallback = `${collectionsUrl}?remove=1`;
          await this.fetchNoContent(fallback, token, 'PUT', 30000);
        }
      }
    }
  }

  async uploadCollectionPoster(params: {
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
    filepath: string;
  }): Promise<void> {
    const { baseUrl, token, collectionRatingKey, filepath } = params;
    const { readFile } = await import('node:fs/promises');
    const fileData = await readFile(filepath);

    const url = new URL(
      `library/metadata/${encodeURIComponent(collectionRatingKey)}/posters`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Plex-Token': token,
        },
        body: fileData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const ms = Date.now() - startedAt;
        this.logger.warn(
          `Plex HTTP POST ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
        );
        throw new BadGatewayException(
          `Plex upload poster failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const ms = Date.now() - startedAt;
      this.logger.debug(`Plex HTTP POST ${safeUrl} -> ${res.status} (${ms}ms)`);
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const ms = Date.now() - startedAt;
      this.logger.warn(
        `Plex HTTP POST ${safeUrl} -> FAILED (${ms}ms): ${(err as Error)?.message ?? String(err)}`.trim(),
      );
      throw new BadGatewayException(
        `Plex upload poster failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async uploadCollectionArt(params: {
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
    filepath: string;
  }): Promise<void> {
    const { baseUrl, token, collectionRatingKey, filepath } = params;
    const { readFile } = await import('node:fs/promises');
    const fileData = await readFile(filepath);

    const url = new URL(
      `library/metadata/${encodeURIComponent(collectionRatingKey)}/arts`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Plex-Token': token,
        },
        body: fileData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const ms = Date.now() - startedAt;
        this.logger.warn(
          `Plex HTTP POST ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
        );
        throw new BadGatewayException(
          `Plex upload art failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const ms = Date.now() - startedAt;
      this.logger.debug(`Plex HTTP POST ${safeUrl} -> ${res.status} (${ms}ms)`);
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const ms = Date.now() - startedAt;
      this.logger.warn(
        `Plex HTTP POST ${safeUrl} -> FAILED (${ms}ms): ${(err as Error)?.message ?? String(err)}`.trim(),
      );
      throw new BadGatewayException(
        `Plex upload art failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async setCollectionHubVisibility(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    collectionRatingKey: string;
    promotedToRecommended: number;
    promotedToOwnHome: number;
    promotedToSharedHome?: number;
  }): Promise<void> {
    const {
      baseUrl,
      token,
      librarySectionKey,
      collectionRatingKey,
      promotedToRecommended,
      promotedToOwnHome,
      promotedToSharedHome = 0,
    } = params;

    const url = new URL(
      `hubs/sections/${encodeURIComponent(librarySectionKey)}/manage`,
      normalizeBaseUrl(baseUrl),
    );
    url.searchParams.set('metadataItemId', collectionRatingKey);
    url.searchParams.set(
      'promotedToRecommended',
      String(promotedToRecommended),
    );
    url.searchParams.set('promotedToOwnHome', String(promotedToOwnHome));
    url.searchParams.set('promotedToSharedHome', String(promotedToSharedHome));

    await this.fetchNoContent(url.toString(), token, 'POST', 20000);
  }

  async getCollectionHubIdentifier(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    collectionRatingKey: string;
  }): Promise<string | null> {
    const { baseUrl, token, librarySectionKey, collectionRatingKey } = params;
    const url = new URL(
      `hubs/sections/${encodeURIComponent(librarySectionKey)}/manage`,
      normalizeBaseUrl(baseUrl),
    );
    url.searchParams.set('metadataItemId', collectionRatingKey);

    const xml = asPlexXml(await this.fetchXml(url.toString(), token, 20000));
    const container = xml.MediaContainer;
    if (!container) return null;

    // Hub endpoint returns items directly (not under Metadata/Video/Directory)
    // Check for common item keys
    const items = asUnknownArray(
      container.Hub ?? container.Directory ?? container.Metadata ?? [],
    );

    if (items.length === 0) return null;
    const first = items[0];
    if (!first || typeof first !== 'object') return null;

    // Plex XML attributes are stored directly on the object (XMLParser with attributeNamePrefix: '')
    const identifier = (first as Record<string, unknown>)['identifier'];
    return typeof identifier === 'string' ? identifier : null;
  }

  async moveHubRow(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    identifier: string;
    after?: string | null;
  }): Promise<void> {
    const { baseUrl, token, librarySectionKey, identifier, after } = params;
    const url = new URL(
      `hubs/sections/${encodeURIComponent(librarySectionKey)}/manage/${encodeURIComponent(identifier)}/move`,
      normalizeBaseUrl(baseUrl),
    );
    if (after) {
      url.searchParams.set('after', after);
    }

    await this.fetchNoContent(url.toString(), token, 'PUT', 20000);
  }

  private buildMetadataUri(machineIdentifier: string, ratingKey: string) {
    // Match Python plexapi format: server://{machineIdentifier}/com.plexapp.plugins.library/library/metadata/{ratingKey}
    return `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;
  }

  private async fetchNoContent(
    url: string,
    token: string,
    method: 'POST' | 'PUT' | 'DELETE',
    timeoutMs: number,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          'X-Plex-Token': token,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const ms = Date.now() - startedAt;
        this.logger.warn(
          `Plex HTTP ${method} ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
        );
        throw new BadGatewayException(
          `Plex request failed: ${method} ${url} -> HTTP ${res.status} ${body}`.trim(),
        );
      }

      const ms = Date.now() - startedAt;
      this.logger.debug(
        `Plex HTTP ${method} ${safeUrl} -> ${res.status} (${ms}ms)`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchXml(
    url: string,
    token: string,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/xml',
          'X-Plex-Token': token,
        },
        signal: controller.signal,
      });

      const text = await res.text().catch(() => '');
      const ms = Date.now() - startedAt;

      if (!res.ok) {
        this.logger.warn(
          `Plex HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${text}`.trim(),
        );
        throw new BadGatewayException(
          `Plex request failed: HTTP ${res.status} ${text}`.trim(),
        );
      }

      this.logger.debug(`Plex HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);
      const parsed: unknown = parser.parse(text) as unknown;
      return parsed;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      const ms = Date.now() - startedAt;
      this.logger.warn(
        `Plex HTTP GET ${safeUrl} -> FAILED (${ms}ms): ${(err as Error)?.message ?? String(err)}`.trim(),
      );
      throw new BadGatewayException(
        `Plex request failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async listSectionItems(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    type?: number;
    includeGuids?: boolean;
    duplicate?: boolean;
    timeoutMs: number;
  }): Promise<PlexMetadata[]> {
    const {
      baseUrl,
      token,
      librarySectionKey,
      type,
      includeGuids,
      duplicate,
      timeoutMs,
    } = params;

    const url = new URL(
      `library/sections/${encodeURIComponent(librarySectionKey)}/all`,
      normalizeBaseUrl(baseUrl),
    );
    if (typeof type === 'number' && Number.isFinite(type)) {
      url.searchParams.set('type', String(Math.trunc(type)));
    }
    if (includeGuids) {
      url.searchParams.set('includeGuids', '1');
    }
    if (duplicate) {
      url.searchParams.set('duplicate', '1');
    }

    const xml = asPlexXml(
      await this.fetchXml(url.toString(), token, timeoutMs),
    );
    const container = xml.MediaContainer;
    return asPlexMetadataArray(container);
  }
}
