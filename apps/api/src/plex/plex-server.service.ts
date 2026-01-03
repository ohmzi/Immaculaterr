import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

type PlexSection = {
  key: string;
  title: string;
  type?: string;
};

type PlexMetadata = Record<string, unknown> & {
  ratingKey?: string;
  title?: string;
  addedAt?: number | string;
  Guid?: unknown;
  parentIndex?: number | string;
  index?: number | string;
  type?: string;
};

type PlexXml = {
  MediaContainer?: Record<string, unknown>;
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

function toStringSafe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

function asPlexXml(value: unknown): PlexXml {
  return value && typeof value === 'object' ? (value as PlexXml) : {};
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function extractFirstInt(value: string): number | null {
  const match = value.match(/(\d{2,})/);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

function extractIdFromGuid(id: string, kind: 'tmdb' | 'tvdb'): number | null {
  const lower = id.toLowerCase();
  const proto = `${kind}://`;
  const idx = lower.indexOf(proto);
  if (idx >= 0) {
    const rest = id.slice(idx + proto.length);
    const clean = rest.split('?')[0].split('&')[0].split('/')[0];
    const n = Number.parseInt(clean, 10);
    if (Number.isFinite(n)) return n;
  }

  if (kind === 'tmdb' && lower.includes('themoviedb')) {
    return extractFirstInt(id);
  }
  if (kind === 'tvdb' && lower.includes('thetvdb')) {
    return extractFirstInt(id);
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
    const id = (g as Record<string, unknown>)['id'];
    if (typeof id !== 'string') continue;
    const parsed = extractIdFromGuid(id, kind);
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

  async findMovieRatingKeyByTitle(params: {
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    title: string;
  }): Promise<{ ratingKey: string; title: string } | null> {
    const { baseUrl, token, librarySectionKey, title } = params;
    const q = title.trim();
    if (!q) return null;

    const url = new URL(
      `library/sections/${librarySectionKey}/search?type=1&query=${encodeURIComponent(q)}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    const xml = asPlexXml(await this.fetchXml(url, token, 20000));
    const container = xml.MediaContainer;
    const items = asArray(
      (container?.Metadata ?? []) as PlexMetadata | PlexMetadata[],
    );

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
    const items = asArray(
      (container?.Metadata ?? []) as PlexMetadata | PlexMetadata[],
    );

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

    const url = new URL(
      `library/sections/${sectionKey}/all`,
      normalizeBaseUrl(baseUrl),
    ).toString();
    const xml = asPlexXml(await this.fetchXml(url, token, 60000));

    const container = xml.MediaContainer;
    const items = asArray(
      (container?.Metadata ?? []) as PlexMetadata | PlexMetadata[],
    );

    const set = new Set<number>();
    for (const item of items) {
      const ids = extractIdsFromGuids(item.Guid, 'tmdb');
      for (const id of ids) set.add(id);
    }

    this.logger.log(
      `Plex TMDB set size=${set.size} section=${movieLibraryName}`,
    );
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

    const url = new URL(
      `library/sections/${sectionKey}/all`,
      normalizeBaseUrl(baseUrl),
    ).toString();
    const xml = asPlexXml(await this.fetchXml(url, token, 60000));

    const container = xml.MediaContainer;
    const items = asArray(
      (container?.Metadata ?? []) as PlexMetadata | PlexMetadata[],
    );

    const map = new Map<number, string>();
    for (const item of items) {
      const ratingKey = item.ratingKey ? String(item.ratingKey) : '';
      if (!ratingKey) continue;

      const ids = extractIdsFromGuids(item.Guid, 'tvdb');
      for (const id of ids) {
        if (!map.has(id)) map.set(id, ratingKey);
      }
    }

    this.logger.log(`Plex TVDB map size=${map.size} section=${tvLibraryName}`);
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
    const items = asArray(
      (container?.Metadata ?? []) as PlexMetadata | PlexMetadata[],
    );

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
    const url = new URL(
      `library/sections/${librarySectionKey}/search?type=18&query=${encodeURIComponent(
        collectionName,
      )}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    const xml = asPlexXml(await this.fetchXml(url, token, 20000));
    const container = xml.MediaContainer;
    const items = asArray(
      (container?.Metadata ?? []) as PlexMetadata | PlexMetadata[],
    );

    for (const item of items) {
      const title = typeof item.title === 'string' ? item.title : '';
      if (title.toLowerCase() !== collectionName.toLowerCase()) continue;
      const ratingKey = item.ratingKey ? String(item.ratingKey) : '';
      if (ratingKey) return ratingKey;
    }

    return null;
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
    const items = asArray(
      (container?.Metadata ?? []) as PlexMetadata | PlexMetadata[],
    );
    return items
      .map((m) => ({
        ratingKey: m.ratingKey ? String(m.ratingKey) : '',
        title: typeof m.title === 'string' ? m.title : '',
      }))
      .filter((x) => x.ratingKey && x.title);
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
    const path = after
      ? `library/collections/${collectionRatingKey}/items/${itemRatingKey}/move?after=${encodeURIComponent(
          after,
        )}`
      : `library/collections/${collectionRatingKey}/items/${itemRatingKey}/move`;

    const url = new URL(path, normalizeBaseUrl(baseUrl)).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'X-Plex-Token': token,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Plex move failed: HTTP ${res.status} ${body}`.trim(),
        );
      }
    } finally {
      clearTimeout(timeout);
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
  }) {
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
    await this.fetchNoContent(url, token, 'POST', 30000);
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
    const url = new URL(
      `library/collections/${encodeURIComponent(collectionRatingKey)}/items?uri=${encodeURIComponent(
        uri,
      )}`,
      normalizeBaseUrl(baseUrl),
    ).toString();
    await this.fetchNoContent(url, token, 'PUT', 30000);
  }

  async removeItemFromCollection(params: {
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
    itemRatingKey: string;
  }) {
    const { baseUrl, token, collectionRatingKey, itemRatingKey } = params;
    const url = new URL(
      `library/collections/${encodeURIComponent(collectionRatingKey)}/items/${encodeURIComponent(
        itemRatingKey,
      )}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    // Best-effort: Plex endpoints vary by server version.
    try {
      await this.fetchNoContent(url, token, 'DELETE', 30000);
    } catch {
      // Some servers accept PUT with ?remove=1
      const fallback = `${url}?remove=1`;
      await this.fetchNoContent(fallback, token, 'PUT', 30000);
    }
  }

  private buildMetadataUri(machineIdentifier: string, ratingKey: string) {
    // Common Plex URI format used for playlist/collection modifications.
    return `server://${machineIdentifier}/com.plexapp.library.library/metadata/${ratingKey}`;
  }

  private async fetchNoContent(
    url: string,
    token: string,
    method: 'POST' | 'PUT' | 'DELETE',
    timeoutMs: number,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
        throw new BadGatewayException(
          `Plex request failed: ${method} ${url} -> HTTP ${res.status} ${body}`.trim(),
        );
      }
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

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/xml',
          'X-Plex-Token': token,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadGatewayException(
          `Plex request failed: HTTP ${res.status} ${body}`.trim(),
        );
      }

      const text = await res.text();
      const parsed: unknown = parser.parse(text) as unknown;
      return parsed;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Plex request failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
