import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol))
      throw new Error('Unsupported protocol');
  } catch {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  return asString(pick(obj, path));
}

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly plexServer: PlexServerService,
  ) {}

  async listCollections() {
    const rows = await this.prisma.curatedCollection.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { items: true } },
      },
    });

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      itemCount: c._count.items,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async createCollection(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('name is required');
    if (trimmed.length > 200) throw new BadRequestException('name is too long');

    try {
      const c = await this.prisma.curatedCollection.create({
        data: { name: trimmed },
        select: { id: true, name: true, createdAt: true, updatedAt: true },
      });
      return {
        id: c.id,
        name: c.name,
        itemCount: 0,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    } catch (err) {
      const code = (err as Prisma.PrismaClientKnownRequestError | undefined)
        ?.code;
      if (code === 'P2002')
        throw new BadRequestException(
          'A collection with this name already exists',
        );
      throw err;
    }
  }

  async seedDefaults() {
    const defaults = [
      'Based on your recently watched movie',
      'Change of Taste',
    ];
    for (const name of defaults) {
      await this.prisma.curatedCollection.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    }
    return await this.listCollections();
  }

  async deleteCollection(collectionId: string) {
    await this.prisma.curatedCollection.delete({ where: { id: collectionId } });
  }

  async listItems(collectionId: string) {
    await this.prisma.curatedCollection
      .findUnique({ where: { id: collectionId } })
      .then((c) => {
        if (!c) throw new BadRequestException('collection not found');
      });

    const items = await this.prisma.curatedCollectionItem.findMany({
      where: { collectionId },
      orderBy: { id: 'asc' },
    });

    return items.map((i) => ({
      id: i.id,
      ratingKey: i.ratingKey,
      title: i.title,
    }));
  }

  async addItem(params: {
    userId: string;
    collectionId: string;
    ratingKey?: string;
    title?: string;
  }) {
    const { userId, collectionId } = params;
    const ratingKeyInput = asString(params.ratingKey);
    const titleInput = asString(params.title);

    await this.prisma.curatedCollection
      .findUnique({ where: { id: collectionId } })
      .then((c) => {
        if (!c) throw new BadRequestException('collection not found');
      });

    let ratingKey = ratingKeyInput;
    let title = titleInput;

    if (!ratingKey && title) {
      const resolved = await this.resolveMovieTitle(userId, title);
      ratingKey = resolved.ratingKey;
      title = resolved.title;
    }

    if (!ratingKey)
      throw new BadRequestException('ratingKey or title is required');
    if (!title) title = ratingKey;

    const item = await this.prisma.curatedCollectionItem.upsert({
      where: {
        collectionId_ratingKey: {
          collectionId,
          ratingKey,
        },
      },
      update: { title },
      create: { collectionId, ratingKey, title },
    });

    return { id: item.id, ratingKey: item.ratingKey, title: item.title };
  }

  async deleteItem(params: { collectionId: string; itemId: number }) {
    const { collectionId, itemId } = params;
    const result = await this.prisma.curatedCollectionItem.deleteMany({
      where: { id: itemId, collectionId },
    });
    if (result.count === 0) throw new BadRequestException('item not found');
  }

  async importFromJson(params: {
    userId: string;
    collectionId: string;
    json: string;
  }) {
    const { userId, collectionId, json } = params;
    const raw = json.trim();
    if (!raw) throw new BadRequestException('json is required');

    await this.prisma.curatedCollection
      .findUnique({ where: { id: collectionId } })
      .then((c) => {
        if (!c) throw new BadRequestException('collection not found');
      });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      throw new BadRequestException(
        `Invalid JSON: ${(err as Error)?.message ?? String(err)}`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException(
        'Expected JSON array (strings or objects).',
      );
    }

    const entries = parsed as unknown[];
    const resolved: Array<{ ratingKey: string; title: string }> = [];
    let skipped = 0;

    for (const entry of entries) {
      if (typeof entry === 'string') {
        const title = entry.trim();
        if (!title) continue;
        const found = await this.resolveMovieTitle(userId, title).catch(
          () => null,
        );
        if (found) resolved.push(found);
        else skipped += 1;
        continue;
      }

      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        const titleRaw = obj['title'];
        const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
        const ratingKeyRaw =
          obj['rating_key'] ?? obj['ratingKey'] ?? obj['rating_key'];
        const ratingKey =
          typeof ratingKeyRaw === 'string'
            ? ratingKeyRaw.trim()
            : typeof ratingKeyRaw === 'number'
              ? String(ratingKeyRaw)
              : '';

        if (ratingKey) {
          resolved.push({ ratingKey, title: title || ratingKey });
          continue;
        }

        if (title) {
          const found = await this.resolveMovieTitle(userId, title).catch(
            () => null,
          );
          if (found) resolved.push(found);
          else skipped += 1;
        }
      }
    }

    if (!resolved.length) {
      return { imported: 0, skipped };
    }

    // Deduplicate by ratingKey
    const unique = new Map<string, string>();
    for (const item of resolved) {
      if (!unique.has(item.ratingKey)) unique.set(item.ratingKey, item.title);
    }

    const ratingKeys = Array.from(unique.keys());
    const existing = await this.prisma.curatedCollectionItem.findMany({
      where: {
        collectionId,
        ratingKey: { in: ratingKeys },
      },
      select: { ratingKey: true },
    });
    const existingSet = new Set(existing.map((e) => e.ratingKey));

    const imported = ratingKeys.filter((rk) => !existingSet.has(rk)).length;

    for (const [ratingKey, title] of unique.entries()) {
      await this.prisma.curatedCollectionItem.upsert({
        where: {
          collectionId_ratingKey: {
            collectionId,
            ratingKey,
          },
        },
        update: { title },
        create: { collectionId, ratingKey, title },
      });
    }

    return { imported, skipped };
  }

  async exportToJson(collectionId: string) {
    await this.prisma.curatedCollection
      .findUnique({ where: { id: collectionId } })
      .then((c) => {
        if (!c) throw new BadRequestException('collection not found');
      });

    const items = await this.prisma.curatedCollectionItem.findMany({
      where: { collectionId },
      orderBy: { id: 'asc' },
      select: { ratingKey: true, title: true },
    });

    return items.map((i) => ({ ratingKey: i.ratingKey, title: i.title }));
  }

  private async resolveMovieTitle(
    userId: string,
    title: string,
  ): Promise<{ ratingKey: string; title: string }> {
    const { settings, secrets } =
      await this.settings.getInternalSettings(userId);

    const baseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const token =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');

    if (!baseUrlRaw) throw new BadRequestException('Plex baseUrl is not set');
    if (!token) throw new BadRequestException('Plex token is not set');

    const baseUrl = normalizeHttpUrl(baseUrlRaw);
    const movieLibraryName =
      pickString(settings, 'plex.movieLibraryName') ||
      pickString(settings, 'plex.movie_library_name') ||
      'Movies';

    const sectionKey = await this.plexServer.findSectionKeyByTitle({
      baseUrl,
      token,
      title: movieLibraryName,
    });

    const found = await this.plexServer.findMovieRatingKeyByTitle({
      baseUrl,
      token,
      librarySectionKey: sectionKey,
      title,
    });

    if (!found)
      throw new BadRequestException(
        `Movie not found in Plex library: ${title}`,
      );
    return found;
  }
}
