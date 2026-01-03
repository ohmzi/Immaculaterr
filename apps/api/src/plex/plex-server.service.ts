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

function asPlexMetadataArray(
  container: Record<string, unknown> | undefined,
): PlexMetadata[] {
  // Plex can return items under different element names depending on endpoint:
  // - /library/sections/:id/all => Video (movies) or Directory (shows)
  // - /library/.../search => Video / Directory
  // - /library/metadata/... => Metadata
  const items = (container?.Metadata ??
    container?.Video ??
    container?.Directory ??
    container?.Track ??
    []) as PlexMetadata | PlexMetadata[];
  return asArray(items);
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
    const url = new URL(
      `library/sections/${librarySectionKey}/search?type=18&query=${encodeURIComponent(
        collectionName,
      )}`,
      normalizeBaseUrl(baseUrl),
    ).toString();

    const xml = asPlexXml(await this.fetchXml(url, token, 20000));
    const container = xml.MediaContainer;
    const items = asPlexMetadataArray(container);

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
    const metaPath = after
      ? `library/metadata/${encodeURIComponent(collectionRatingKey)}/items/${encodeURIComponent(
          itemRatingKey,
        )}/move?after=${encodeURIComponent(after)}`
      : `library/metadata/${encodeURIComponent(collectionRatingKey)}/items/${encodeURIComponent(
          itemRatingKey,
        )}/move`;
    const metaUrl = new URL(metaPath, normalizeBaseUrl(baseUrl)).toString();

    try {
      await this.fetchNoContent(metaUrl, token, 'PUT', 20000);
      return;
    } catch {
      // Fallback: some servers accept /library/collections/... paths
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
      await this.fetchNoContent(collectionsUrl, token, 'PUT', 20000);
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
    const metaUrl = new URL(
      `library/metadata/${encodeURIComponent(collectionRatingKey)}/items`,
      normalizeBaseUrl(baseUrl),
    );
    metaUrl.searchParams.set('uri', uri);

    try {
      await this.fetchNoContent(metaUrl.toString(), token, 'PUT', 30000);
      return;
    } catch {
      // Fallback: some servers accept /library/collections/... paths
      const collectionsUrl = new URL(
        `library/collections/${encodeURIComponent(collectionRatingKey)}/items`,
        normalizeBaseUrl(baseUrl),
      );
      collectionsUrl.searchParams.set('uri', uri);
      await this.fetchNoContent(collectionsUrl.toString(), token, 'PUT', 30000);
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
      this.logger.log(`Plex HTTP POST ${safeUrl} -> ${res.status} (${ms}ms)`);
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
      this.logger.log(`Plex HTTP POST ${safeUrl} -> ${res.status} (${ms}ms)`);
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
      this.logger.log(
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

      this.logger.log(`Plex HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);
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
}
