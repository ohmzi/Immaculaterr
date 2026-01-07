import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { SettingsService } from '../settings/settings.service';
import { immaculateTasteResetMarkerKey } from './immaculate-taste-reset';

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
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new BadRequestException('Plex baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

const IMMACULATE_PLEX_COLLECTION_NAME = 'Inspired by your Immaculate Taste';

type ResetBody = {
  mediaType?: unknown;
  librarySectionKey?: unknown;
};

@Controller('immaculate-taste')
@ApiTags('immaculate-taste')
export class ImmaculateTasteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
  ) {}

  @Get('collections')
  async listCollections(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    const { settings, secrets } = await this.settingsService.getInternalSettings(
      userId,
    );

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new BadRequestException('Plex baseUrl is not set');
    if (!plexToken) throw new BadRequestException('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const movieSections = sections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'movie',
    );
    const tvSections = sections.filter(
      (s) => (s.type ?? '').toLowerCase() === 'show',
    );

    const movieEntries = await Promise.all(
      movieSections.map(async (sec) => {
        const [total, active, pending] = await Promise.all([
          this.prisma.immaculateTasteMovieLibrary.count({
            where: { librarySectionKey: sec.key },
          }),
          this.prisma.immaculateTasteMovieLibrary.count({
            where: {
              librarySectionKey: sec.key,
              status: 'active',
              points: { gt: 0 },
            },
          }),
          this.prisma.immaculateTasteMovieLibrary.count({
            where: { librarySectionKey: sec.key, status: 'pending' },
          }),
        ]);

        let collectionRatingKey: string | null = null;
        let plexItemCount: number | null = null;
        try {
          collectionRatingKey = await this.plexServer.findCollectionRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: sec.key,
            collectionName: IMMACULATE_PLEX_COLLECTION_NAME,
          });
          if (collectionRatingKey) {
            const items = await this.plexServer.getCollectionItems({
              baseUrl: plexBaseUrl,
              token: plexToken,
              collectionRatingKey,
            });
            plexItemCount = items.length;
          }
        } catch {
          // Non-fatal: keep nulls if Plex is flaky
        }

        return {
          mediaType: 'movie' as const,
          librarySectionKey: sec.key,
          libraryTitle: sec.title,
          dataset: { total, active, pending },
          plex: {
            collectionName: IMMACULATE_PLEX_COLLECTION_NAME,
            collectionRatingKey,
            itemCount: plexItemCount,
          },
        };
      }),
    );

    const tvEntries = await Promise.all(
      tvSections.map(async (sec) => {
        const [total, active, pending] = await Promise.all([
          this.prisma.immaculateTasteShowLibrary.count({
            where: { librarySectionKey: sec.key },
          }),
          this.prisma.immaculateTasteShowLibrary.count({
            where: {
              librarySectionKey: sec.key,
              status: 'active',
              points: { gt: 0 },
            },
          }),
          this.prisma.immaculateTasteShowLibrary.count({
            where: { librarySectionKey: sec.key, status: 'pending' },
          }),
        ]);

        let collectionRatingKey: string | null = null;
        let plexItemCount: number | null = null;
        try {
          collectionRatingKey = await this.plexServer.findCollectionRatingKey({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: sec.key,
            collectionName: IMMACULATE_PLEX_COLLECTION_NAME,
          });
          if (collectionRatingKey) {
            const items = await this.plexServer.getCollectionItems({
              baseUrl: plexBaseUrl,
              token: plexToken,
              collectionRatingKey,
            });
            plexItemCount = items.length;
          }
        } catch {
          // Non-fatal
        }

        return {
          mediaType: 'tv' as const,
          librarySectionKey: sec.key,
          libraryTitle: sec.title,
          dataset: { total, active, pending },
          plex: {
            collectionName: IMMACULATE_PLEX_COLLECTION_NAME,
            collectionRatingKey,
            itemCount: plexItemCount,
          },
        };
      }),
    );

    return {
      collectionName: IMMACULATE_PLEX_COLLECTION_NAME,
      collections: [...movieEntries, ...tvEntries],
    };
  }

  @Post('collections/reset')
  async resetCollection(@Req() req: AuthenticatedRequest, @Body() body: ResetBody) {
    const userId = req.user.id;
    const mediaTypeRaw = typeof body?.mediaType === 'string' ? body.mediaType.trim() : '';
    const mediaType = mediaTypeRaw.toLowerCase();
    const librarySectionKey =
      typeof body?.librarySectionKey === 'string' ? body.librarySectionKey.trim() : '';

    if (mediaType !== 'movie' && mediaType !== 'tv') {
      throw new BadRequestException('mediaType must be "movie" or "tv"');
    }
    if (!librarySectionKey) {
      throw new BadRequestException('librarySectionKey is required');
    }

    const { settings, secrets } = await this.settingsService.getInternalSettings(
      userId,
    );

    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new BadRequestException('Plex baseUrl is not set');
    if (!plexToken) throw new BadRequestException('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    const sections = await this.plexServer.getSections({
      baseUrl: plexBaseUrl,
      token: plexToken,
    });
    const sec = sections.find((s) => s.key === librarySectionKey) ?? null;
    if (!sec) {
      throw new BadRequestException('Plex library section not found');
    }

    const secType = (sec.type ?? '').toLowerCase();
    if (mediaType === 'movie' && secType !== 'movie') {
      throw new BadRequestException('librarySectionKey is not a movie library');
    }
    if (mediaType === 'tv' && secType !== 'show') {
      throw new BadRequestException('librarySectionKey is not a TV library');
    }

    // Delete Plex collection (if present)
    let plexDeleted = false;
    let collectionRatingKey: string | null = null;
    try {
      collectionRatingKey = await this.plexServer.findCollectionRatingKey({
        baseUrl: plexBaseUrl,
        token: plexToken,
        librarySectionKey,
        collectionName: IMMACULATE_PLEX_COLLECTION_NAME,
      });
      if (collectionRatingKey) {
        await this.plexServer.deleteCollection({
          baseUrl: plexBaseUrl,
          token: plexToken,
          collectionRatingKey,
        });
        plexDeleted = true;
      }
    } catch {
      // ignore (Plex flakiness)
    }

    // Delete dataset rows
    const datasetDeleted =
      mediaType === 'movie'
        ? await this.prisma.immaculateTasteMovieLibrary.deleteMany({
            where: { librarySectionKey },
          })
        : await this.prisma.immaculateTasteShowLibrary.deleteMany({
            where: { librarySectionKey },
          });

    // Prevent legacy auto-bootstrap from restoring data immediately after a reset.
    // (Back-compat: the app can import legacy datasets when a library has 0 rows.)
    await this.prisma.setting
      .upsert({
        where: { key: immaculateTasteResetMarkerKey({ mediaType, librarySectionKey }) },
        update: { value: new Date().toISOString(), encrypted: false },
        create: {
          key: immaculateTasteResetMarkerKey({ mediaType, librarySectionKey }),
          value: new Date().toISOString(),
          encrypted: false,
        },
      })
      .catch(() => undefined);

    return {
      ok: true,
      mediaType,
      librarySectionKey,
      libraryTitle: sec.title,
      plex: {
        collectionName: IMMACULATE_PLEX_COLLECTION_NAME,
        collectionRatingKey,
        deleted: plexDeleted,
      },
      dataset: {
        deleted: datasetDeleted.count,
      },
    };
  }
}


