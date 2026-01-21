import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { PlexServerService } from './plex-server.service';
import { stripUserCollectionPrefix } from './plex-collections.utils';

const CURATED_COLLECTION_HUB_ORDER = [
  'Based on your recently watched movie',
  'Inspired by your Immaculate Taste',
  'Change of Taste',
] as const;

@Injectable()
export class PlexCuratedCollectionsService {
  constructor(private readonly plexServer: PlexServerService) {}

  async rebuildMovieCollection(params: {
    ctx: JobContext;
    baseUrl: string;
    token: string;
    machineIdentifier: string;
    movieSectionKey: string;
    collectionName: string;
    /**
     * Plex item type for the target library.
     * - 1 = movie
     * - 2 = show
     *
     * Default is 1 for backwards compatibility.
     */
    itemType?: 1 | 2;
    desiredItems: Array<{ ratingKey: string; title: string }>;
    randomizeOrder?: boolean;
    pinCollections?: boolean;
    collectionHubOrder?: string[];
  }): Promise<JsonObject> {
    const {
      ctx,
      baseUrl,
      token,
      machineIdentifier,
      movieSectionKey,
      collectionName,
      itemType = 1,
      desiredItems,
      randomizeOrder = false,
      pinCollections = true,
      collectionHubOrder,
    } = params;

    const mediaType = itemType === 2 ? 'tv' : 'movie';
    const unitLabel = itemType === 2 ? 'shows' : 'movies';

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_collection_sync',
          message: `Locating Plex collection: ${collectionName}…`,
          mediaType,
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    // Deduplicate by ratingKey (keep first title)
    const uniq = new Map<string, string>();
    for (const it of desiredItems) {
      if (!it?.ratingKey) continue;
      if (!uniq.has(it.ratingKey))
        uniq.set(it.ratingKey, it.title || it.ratingKey);
    }

    const desiredBase = Array.from(uniq.entries()).map(
      ([ratingKey, title]) => ({
        ratingKey,
        title,
      }),
    );

    const desired = randomizeOrder ? shuffle(desiredBase.slice()) : desiredBase;

    // Find existing Plex collection (if any)
    let plexCollectionKey = await this.plexServer.findCollectionRatingKey({
      baseUrl,
      token,
      librarySectionKey: movieSectionKey,
      collectionName,
    });

    let existingItems: Array<{ ratingKey: string; title: string }> = [];
    if (plexCollectionKey) {
      try {
        existingItems = await this.plexServer.getCollectionItems({
          baseUrl,
          token,
          collectionRatingKey: plexCollectionKey,
        });
      } catch (err) {
        await ctx.warn(
          'collection: failed to load existing items (continuing)',
          {
            collectionName,
            plexCollectionKey,
            error: (err as Error)?.message ?? String(err),
          },
        );
      }
    }
    const existingCount = existingItems.length;

    if (ctx.dryRun) {
      await ctx.info('collection: dry-run preview', {
        collectionName,
        plexCollectionKey,
        existingCount,
        desiredCount: desired.length,
        strategy: plexCollectionKey ? 'recreate' : 'create',
        randomizeOrder,
      });
      return {
        collectionName,
        plexCollectionKey,
        existingCount,
        desiredCount: desired.length,
        removed: existingCount,
        added: desired.length,
        moved: desired.length,
        skipped: Math.max(0, desiredItems.length - desired.length),
        randomizeOrder,
        sample: desired.slice(0, 10).map((d) => d.title),
      };
    }

    let removed = 0;
    let added = 0;
    let skipped = 0;

    // If the collection already exists, delete it so we can recreate with a fresh order.
    // This avoids cases where Plex keeps the old ordering even after remove/re-add.
    if (plexCollectionKey) {
      void ctx
        .patchSummary({
          progress: {
            step: 'plex_collection_sync',
            message: `Recreating Plex collection: ${collectionName}…`,
            mediaType,
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
      await ctx.info(
        'collection: deleting existing Plex collection for refresh',
        {
          collectionName,
          plexCollectionKey,
          existingCount,
        },
      );

      try {
        const oldKey = plexCollectionKey;
        await this.plexServer.deleteCollection({
          baseUrl,
          token,
          collectionRatingKey: oldKey,
        });

        // Best-effort: wait for deletion to propagate (avoids duplicate collections).
        let gone = false;
        for (let i = 0; i < 12; i += 1) {
          const stillThere = await this.plexServer.findCollectionRatingKey({
            baseUrl,
            token,
            librarySectionKey: movieSectionKey,
            collectionName,
          });
          if (!stillThere) {
            gone = true;
            break;
          }
          await sleep(250);
        }

        if (gone) {
          removed = existingCount;
          plexCollectionKey = null;
          existingItems = [];
        } else {
          await ctx.warn(
            'collection: delete did not fully propagate; falling back to in-place refresh',
            {
              collectionName,
              plexCollectionKey: oldKey,
            },
          );
          plexCollectionKey = oldKey;
        }
      } catch (err) {
        await ctx.warn(
          'collection: failed to delete existing Plex collection; falling back to in-place refresh',
          {
            collectionName,
            plexCollectionKey,
            error: (err as Error)?.message ?? String(err),
          },
        );
      }
    }

    // Ensure Plex collection exists (create new if deleted/missing)
    if (!plexCollectionKey) {
      void ctx
        .patchSummary({
          progress: {
            step: 'plex_collection_sync',
            message: `Creating Plex collection: ${collectionName}…`,
            mediaType,
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
      await ctx.info('collection: creating Plex collection', {
        collectionName,
      });
      const first = desired[0]?.ratingKey ?? null;
      if (!first) {
        await ctx.warn('collection: cannot create Plex collection (no items)', {
          collectionName,
        });
        return {
          collectionName,
          plexCollectionKey: null,
          existingCount,
          desiredCount: desired.length,
          removed: existingCount,
          added: 0,
          moved: 0,
          skipped,
          randomizeOrder,
        };
      }

      await this.plexServer.createCollection({
        baseUrl,
        token,
        machineIdentifier,
        librarySectionKey: movieSectionKey,
        collectionName,
        type: itemType,
        initialItemRatingKey: first,
      });

      // Find the newly created collection ratingKey (with small retry)
      for (let i = 0; i < 10; i += 1) {
        plexCollectionKey = await this.plexServer.findCollectionRatingKey({
          baseUrl,
          token,
          librarySectionKey: movieSectionKey,
          collectionName,
        });
        if (plexCollectionKey) break;
        await sleep(200);
      }

      if (!plexCollectionKey) {
        throw new Error(
          `Failed to find or create Plex collection: ${collectionName}`,
        );
      }

      // First item was included during createCollection (uri=...), add the rest in order.
      removed = existingCount;
      added = 1;
      if (desired.length > 1) {
        await ctx.info('collection: adding items', {
          collectionName,
          total: desired.length,
        });
      }
      for (const item of desired.slice(1)) {
        try {
          await this.plexServer.addItemToCollection({
            baseUrl,
            token,
            machineIdentifier,
            collectionRatingKey: plexCollectionKey,
            itemRatingKey: item.ratingKey,
          });
          added += 1;
          if (added % 50 === 0 || added === desired.length) {
            await ctx.info('collection: add progress', {
              collectionName,
              added,
              total: desired.length,
            });
            void ctx
              .patchSummary({
                progress: {
                  step: 'plex_collection_add',
                  message: `Adding items to Plex collection: ${collectionName}`,
                  current: added,
                  total: desired.length,
                  unit: unitLabel,
                  mediaType,
                  updatedAt: new Date().toISOString(),
                },
              })
              .catch(() => undefined);
          }
        } catch (err) {
          skipped += 1;
          await ctx.warn('collection: failed to add item (continuing)', {
            collectionName,
            ratingKey: item.ratingKey,
            title: item.title,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }
    } else {
      // Fallback: refresh collection in-place (remove all, then re-add in desired order)
      for (const item of existingItems) {
        try {
          await this.plexServer.removeItemFromCollection({
            baseUrl,
            token,
            collectionRatingKey: plexCollectionKey,
            itemRatingKey: item.ratingKey,
          });
          removed += 1;
          if (removed % 100 === 0 || removed === existingItems.length) {
            await ctx.info('collection: remove progress', {
              collectionName,
              removed,
              total: existingItems.length,
            });
            void ctx
              .patchSummary({
                progress: {
                  step: 'plex_collection_remove',
                  message: `Removing items from Plex collection: ${collectionName}`,
                  current: removed,
                  total: existingItems.length,
                  unit: unitLabel,
                  mediaType,
                  updatedAt: new Date().toISOString(),
                },
              })
              .catch(() => undefined);
          }
        } catch (err) {
          await ctx.warn('collection: failed to remove item (continuing)', {
            collectionName,
            ratingKey: item.ratingKey,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }

      for (const item of desired) {
        try {
          await this.plexServer.addItemToCollection({
            baseUrl,
            token,
            machineIdentifier,
            collectionRatingKey: plexCollectionKey,
            itemRatingKey: item.ratingKey,
          });
          added += 1;
          if (added % 50 === 0 || added === desired.length) {
            await ctx.info('collection: add progress', {
              collectionName,
              added,
              total: desired.length,
            });
            void ctx
              .patchSummary({
                progress: {
                  step: 'plex_collection_add',
                  message: `Adding items to Plex collection: ${collectionName}`,
                  current: added,
                  total: desired.length,
                  unit: unitLabel,
                  mediaType,
                  updatedAt: new Date().toISOString(),
                },
              })
              .catch(() => undefined);
          }
        } catch (err) {
          skipped += 1;
          await ctx.warn('collection: failed to add item (continuing)', {
            collectionName,
            ratingKey: item.ratingKey,
            title: item.title,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }
    }

    if (!plexCollectionKey) {
      throw new Error(
        `Failed to find or create Plex collection: ${collectionName}`,
      );
    }

    // Force collection order to 'custom' (required for move operations to reflect in Plex UI)
    try {
      await this.plexServer.setCollectionSort({
        baseUrl,
        token,
        collectionRatingKey: plexCollectionKey,
        sort: 'custom',
      });
    } catch (err) {
      await ctx.warn(
        'collection: failed to set collection sort=custom (continuing)',
        {
          collectionName,
          plexCollectionKey,
          error: (err as Error)?.message ?? String(err),
        },
      );
    }

    // Apply custom order by moving items
    let moved = 0;
    let prev: string | null = null;
    await ctx.info('collection: applying custom order', {
      collectionName,
      total: desired.length,
    });
    void ctx
      .patchSummary({
        progress: {
          step: 'plex_collection_reorder',
          message: `Ordering Plex collection: ${collectionName}`,
          current: 0,
          total: desired.length,
          unit: unitLabel,
          mediaType,
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);
    for (const item of desired) {
      try {
        await this.plexServer.moveCollectionItem({
          baseUrl,
          token,
          collectionRatingKey: plexCollectionKey,
          itemRatingKey: item.ratingKey,
          after: prev,
        });
        prev = item.ratingKey;
        moved += 1;
        if (moved % 25 === 0 || moved === desired.length) {
          await ctx.info('collection: order progress', {
            collectionName,
            moved,
            total: desired.length,
          });
          void ctx
            .patchSummary({
              progress: {
                step: 'plex_collection_reorder',
                message: `Ordering Plex collection: ${collectionName}`,
                current: moved,
                total: desired.length,
                unit: unitLabel,
                mediaType,
                updatedAt: new Date().toISOString(),
              },
            })
            .catch(() => undefined);
        }
      } catch (err) {
        await ctx.warn('collection: failed to move item (continuing)', {
          collectionName,
          ratingKey: item.ratingKey,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    // Set collection artwork if available (only if items were added or collection existed)
    if (plexCollectionKey && (added > 0 || existingCount > 0) && !ctx.dryRun) {
      try {
        await ctx.info('collection: setting artwork', { collectionName });
        await this.setCollectionArtwork({
          ctx,
          baseUrl,
          token,
          collectionRatingKey: plexCollectionKey,
          collectionName,
        });
      } catch (err) {
        await ctx.warn('collection: failed to set artwork (non-critical)', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    // Pin collections to home/library (only if items were added or collection existed)
    if (
      pinCollections &&
      plexCollectionKey &&
      (added > 0 || existingCount > 0) &&
      !ctx.dryRun
    ) {
      try {
        await ctx.info('collection: pinning to home/library', {
          collectionName,
        });
        await this.pinCuratedCollectionHubs({
          ctx,
          baseUrl,
          token,
          librarySectionKey: movieSectionKey,
          collectionHubOrder:
            collectionHubOrder ?? Array.from(CURATED_COLLECTION_HUB_ORDER),
        });
      } catch (err) {
        await ctx.warn('collection: failed to pin hubs (non-critical)', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    return {
      collectionName,
      plexCollectionKey,
      existingCount,
      desiredCount: desired.length,
      removed,
      added,
      moved,
      skipped,
      randomizeOrder,
      sample: desired.slice(0, 10).map((d) => d.title),
    };
  }

  private async setCollectionArtwork(params: {
    ctx: JobContext;
    baseUrl: string;
    token: string;
    collectionRatingKey: string;
    collectionName: string;
  }): Promise<void> {
    const { ctx, baseUrl, token, collectionRatingKey, collectionName } = params;

    const artworkPaths = this.getArtworkPaths(collectionName);
    if (!artworkPaths.poster && !artworkPaths.background) {
      await ctx.debug('collection: no artwork files found', { collectionName });
      return;
    }

    if (artworkPaths.poster) {
      try {
        await this.plexServer.uploadCollectionPoster({
          baseUrl,
          token,
          collectionRatingKey,
          filepath: artworkPaths.poster,
        });
        await ctx.info('collection: poster set', {
          collectionName,
          poster: path.basename(artworkPaths.poster),
        });
      } catch (err) {
        await ctx.warn('collection: failed to set poster', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    if (artworkPaths.background) {
      try {
        await this.plexServer.uploadCollectionArt({
          baseUrl,
          token,
          collectionRatingKey,
          filepath: artworkPaths.background,
        });
        await ctx.info('collection: background set', {
          collectionName,
          background: path.basename(artworkPaths.background),
        });
      } catch (err) {
        await ctx.warn('collection: failed to set background', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }
  }

  private async pinCuratedCollectionHubs(params: {
    ctx: JobContext;
    baseUrl: string;
    token: string;
    librarySectionKey: string;
    collectionHubOrder: string[];
  }): Promise<void> {
    const { ctx, baseUrl, token, librarySectionKey, collectionHubOrder } = params;

    const stats = {
      requested: collectionHubOrder.length,
      found: 0,
      updated: 0,
      missing: 0,
      failed: 0,
    };

    // First, set visibility for all collections
    for (const collectionName of collectionHubOrder) {
      try {
        const collectionKey = await this.plexServer.findCollectionRatingKey({
          baseUrl,
          token,
          librarySectionKey,
          collectionName,
        });

        if (!collectionKey) {
          stats.missing += 1;
          await ctx.debug('hub_pin: collection missing', { collectionName });
          continue;
        }

        stats.found += 1;
        try {
          await this.plexServer.setCollectionHubVisibility({
            baseUrl,
            token,
            librarySectionKey,
            collectionRatingKey: collectionKey,
            promotedToRecommended: 1,
            promotedToOwnHome: 1,
            promotedToSharedHome: 0,
          });
          stats.updated += 1;
          await ctx.info('hub_pin: set visible_on(library,home)=ON', {
            collectionName,
          });
        } catch (err) {
          stats.failed += 1;
          await ctx.warn('hub_pin: failed updating hub settings', {
            collectionName,
            error: (err as Error)?.message ?? String(err),
          });
        }
      } catch (err) {
        stats.failed += 1;
        await ctx.warn('hub_pin: failed loading collection', {
          collectionName,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    // Now reorder the hubs so they appear as top rows
    try {
      const identifiers: string[] = [];
      const collections: string[] = [];

      for (const collectionName of collectionHubOrder) {
        try {
          const collectionKey = await this.plexServer.findCollectionRatingKey({
            baseUrl,
            token,
            librarySectionKey,
            collectionName,
          });

          if (!collectionKey) continue;

          const identifier = await this.plexServer.getCollectionHubIdentifier({
            baseUrl,
            token,
            librarySectionKey,
            collectionRatingKey: collectionKey,
          });

          if (identifier) {
            identifiers.push(identifier);
            collections.push(collectionName);
          }
        } catch (err) {
          await ctx.debug('hub_pin: failed to get identifier', {
            collectionName,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }

      if (identifiers.length > 0) {
        // Move first to the top, then chain "after=" for the rest
        const first = identifiers[0];
        await this.plexServer.moveHubRow({
          baseUrl,
          token,
          librarySectionKey,
          identifier: first,
          after: null,
        });

        let prev = first;
        for (let i = 1; i < identifiers.length; i++) {
          await this.plexServer.moveHubRow({
            baseUrl,
            token,
            librarySectionKey,
            identifier: identifiers[i],
            after: prev,
          });
          prev = identifiers[i];
        }

        await ctx.info('hub_pin: reordered top collections', {
          collections,
          identifiers,
        });
      }
    } catch (err) {
      await ctx.warn('hub_pin: reorder failed (non-critical)', {
        error: (err as Error)?.message ?? String(err),
      });
    }

    await ctx.info('hub_pin: done', { stats });
  }

  private getArtworkPaths(collectionName: string): {
    poster: string | null;
    background: string | null;
  } {
    const normalizedName = stripUserCollectionPrefix(collectionName)
      .trim()
      .toLowerCase();
    const collectionArtworkMap: Record<string, string> = {
      'inspired by your immaculate taste': 'immaculate_taste_collection',
      'based on your recently watched movie': 'recently_watched_collection',
      'based on your recently watched show': 'recently_watched_collection',
      'change of taste': 'change_of_taste_collection',
    };

    const artworkName = collectionArtworkMap[normalizedName];
    if (!artworkName) {
      return { poster: null, background: null };
    }

    // Find curated artwork directory.
    // In-repo source of truth: apps/web/src/assets/collection_artwork
    // Runtime (Docker) may copy it into either:
    // - /app/apps/web/src/assets/collection_artwork (new canonical path)
    // - /app/assets/collection_artwork (legacy path)
    //
    // Try common layouts relative to current working directory.
    const cwd = process.cwd();
    const roots = [cwd, join(cwd, '..'), join(cwd, '..', '..'), join(cwd, '..', '..', '..')];
    const rels = [
      join('apps', 'web', 'src', 'assets', 'collection_artwork'),
      join('assets', 'collection_artwork'), // legacy
    ];
    const candidates = roots.flatMap((root) => rels.map((rel) => join(root, rel)));

    let assetsDir: string | null = null;
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        assetsDir = candidate;
        break;
      }
    }

    if (!assetsDir) {
      return { poster: null, background: null };
    }

    // Try .png first, then .jpg
    const posterPng = join(assetsDir, 'posters', `${artworkName}.png`);
    const posterJpg = join(assetsDir, 'posters', `${artworkName}.jpg`);
    const poster = existsSync(posterPng)
      ? posterPng
      : existsSync(posterJpg)
        ? posterJpg
        : null;

    const backgroundPng = join(assetsDir, 'backgrounds', `${artworkName}.png`);
    const backgroundJpg = join(assetsDir, 'backgrounds', `${artworkName}.jpg`);
    const background = existsSync(backgroundPng)
      ? backgroundPng
      : existsSync(backgroundJpg)
        ? backgroundJpg
        : null;

    return { poster, background };
  }
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
