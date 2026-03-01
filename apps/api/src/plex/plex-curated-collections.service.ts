import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import type { JobContext, JsonObject } from '../jobs/jobs.types';
import { PlexServerService } from './plex-server.service';
import {
  CURATED_MOVIE_COLLECTION_HUB_ORDER,
  hasSameCuratedCollectionBase,
  normalizeCollectionTitle,
  resolveCuratedCollectionBaseName,
  sortCollectionNamesByCuratedBaseOrder,
  stripUserCollectionPrefix,
} from './plex-collections.utils';

type PinTarget = 'admin' | 'friends';
type PreferredHubTarget = {
  collectionName: string;
  collectionKey: string;
};

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
    pinTarget?: PinTarget;
    collectionHubOrder?: string[];
    preferredHubTargets?: PreferredHubTarget[];
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
      pinTarget = 'admin',
      collectionHubOrder,
      preferredHubTargets = [],
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

    // Collection names use format: "Collection Name (username)"

    // Get all collections for this section
    const allCollections = await this.plexServer.listCollectionsForSectionKey({
      baseUrl,
      token,
      librarySectionKey: movieSectionKey,
      take: 500,
    });

    // Find matching collections: first try exact match, then normalized match
    // Collection format: "Collection Name (username)"
    const exactMatches: Array<{ ratingKey: string; title: string }> = [];
    const normalizedMatches: Array<{ ratingKey: string; title: string }> = [];
    
    const normalizedTarget = normalizeCollectionTitle(collectionName);

    for (const coll of allCollections) {
      const collTitle = coll.title || '';
      const collNormalized = normalizeCollectionTitle(collTitle);
      
      // Exact match (case-insensitive)
      if (collTitle.toLowerCase() === collectionName.toLowerCase()) {
        exactMatches.push(coll);
      }
      // Normalized match (handles variations in spaces, parentheses, etc.)
      else if (collNormalized === normalizedTarget) {
        normalizedMatches.push(coll);
      }
    }

    // Prefer exact matches, but include normalized matches if no exact match
    const matchingCollections = exactMatches.length > 0 ? exactMatches : normalizedMatches;

    // Try to delete matching collections using their ratingKey (metadata ID)
    let deletedSuccessfully = false;
    if (!ctx.dryRun && matchingCollections.length) {
      await ctx.info('collection: deleting existing Plex collections by ratingKey', {
        collectionName,
        targetRatingKeys: matchingCollections.map((c) => c.ratingKey),
        matches: matchingCollections.map((c) => ({
          title: c.title,
          ratingKey: c.ratingKey,
          matchType: exactMatches.includes(c) ? 'exact' : 'normalized',
        })),
      });
      
      for (const match of matchingCollections) {
        try {
          // Delete using the ratingKey (metadata ID) directly
          await this.plexServer.deleteCollection({
            baseUrl,
            token,
            collectionRatingKey: match.ratingKey,
          });
          await ctx.info('collection: successfully deleted', {
            collectionName: match.title,
            ratingKey: match.ratingKey,
          });
          deletedSuccessfully = true;
        } catch (err) {
          await ctx.warn('collection: failed to delete Plex collection by ratingKey, will remove items instead', {
            collectionName: match.title,
            ratingKey: match.ratingKey,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }
      
      // Wait for deletion to complete and verify (up to 5 seconds)
      if (deletedSuccessfully) {
        const targetRatingKeys = new Set(matchingCollections.map((c) => c.ratingKey));
        for (let i = 0; i < 20; i += 1) {
          await sleep(250);
          const remaining = await this.plexServer.listCollectionsForSectionKey({
            baseUrl,
            token,
            librarySectionKey: movieSectionKey,
            take: 500,
          });
          // Check if any of the deleted collections still exist by ratingKey
          const stillThere = remaining.filter((c) => targetRatingKeys.has(c.ratingKey));
          if (!stillThere.length) {
            await ctx.info('collection: verified deletion complete', {
              collectionName,
              deletedCount: matchingCollections.length,
            });
            deletedSuccessfully = true;
            break;
          }
          if (i === 19) {
            await ctx.warn('collection: deletion verification timeout, collections may still exist', {
              collectionName,
              stillExisting: stillThere.map((c) => ({ title: c.title, ratingKey: c.ratingKey })),
            });
          }
        }
      }
    }

    let plexCollectionKey: string | null = null;
    let lastAddedTitle: string | null = null;
    let collectionItems: string[] = [];
    let collectionItemsSource: 'plex' | 'desired_fallback' = 'desired_fallback';
    let existingItems: Array<{ ratingKey: string; title: string }> = [];
    let existingCount = 0;

    // Check if collection still exists after deletion attempt (in case deletion failed or didn't complete)
    // If it exists, we need to get its items so we can remove them before adding new ones
    if (!ctx.dryRun) {
      // Wait a bit for deletion to propagate if it was successful
      if (deletedSuccessfully) {
        await sleep(500);
      }
      
      for (let i = 0; i < 10; i += 1) {
        plexCollectionKey = await this.plexServer.findCollectionRatingKey({
          baseUrl,
          token,
          librarySectionKey: movieSectionKey,
          collectionName,
        });
        if (!plexCollectionKey) {
          // Collection was successfully deleted, we can create a new one
          break;
        }
        // Collection still exists (deletion failed or didn't complete), get its items
        try {
          existingItems = await this.plexServer.getCollectionItems({
            baseUrl,
            token,
            collectionRatingKey: plexCollectionKey,
          });
          existingCount = existingItems.length;
          if (existingCount > 0) {
            await ctx.info('collection: found existing collection with items, will remove them', {
              collectionName,
              plexCollectionKey,
              existingCount,
            });
          } else {
            await ctx.info('collection: found existing collection but it is empty', {
              collectionName,
              plexCollectionKey,
            });
          }
          break;
        } catch (err) {
          await ctx.warn('collection: failed to get existing items, will retry', {
            collectionName,
            plexCollectionKey,
            attempt: i + 1,
            error: (err as Error)?.message ?? String(err),
          });
          // Retry after a short delay
          await sleep(300);
          if (i === 9) {
            // Last attempt failed, assume collection is empty or broken
            existingItems = [];
            existingCount = 0;
          }
        }
      }
    }

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
        lastAddedTitle: null,
        collectionItems: desired.map((d) => d.title).filter(Boolean),
        sample: desired.slice(0, 10).map((d) => d.title),
      };
    }

    let removed = 0;
    let added = 0;
    let skipped = 0;

    // Collections were deleted above to ensure a clean rebuild.
    // If collection still exists, we'll remove its items before adding new ones.

    // If collection exists, remove all existing items first
    if (plexCollectionKey && existingCount > 0 && existingItems.length > 0) {
      await ctx.info('collection: removing all existing items before rebuild', {
        collectionName,
        existingCount,
        plexCollectionKey,
      });
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
      // Wait a moment for removals to propagate
      await sleep(500);
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
          lastAddedTitle: null,
          collectionItems: [],
        };
      }

      let createdKey: string | null = null;
      try {
        createdKey = await this.plexServer.createCollection({
          baseUrl,
          token,
          machineIdentifier,
          librarySectionKey: movieSectionKey,
          collectionName,
          type: itemType,
          initialItemRatingKey: first,
        });
      } catch (err) {
        await ctx.warn(
          'collection: create with seeded item failed, retrying without seed item',
          {
            collectionName,
            movieSectionKey,
            itemType,
            seedRatingKey: first,
            error: (err as Error)?.message ?? String(err),
          },
        );
        createdKey = await this.plexServer.createCollection({
          baseUrl,
          token,
          machineIdentifier,
          librarySectionKey: movieSectionKey,
          collectionName,
          type: itemType,
          initialItemRatingKey: null,
        });
      }
      if (createdKey) {
        plexCollectionKey = createdKey;
      }

      // Find the newly created collection ratingKey (with extended retry)
      if (!plexCollectionKey) {
        for (let i = 0; i < 25; i += 1) {
          plexCollectionKey = await this.plexServer.findCollectionRatingKey({
            baseUrl,
            token,
            librarySectionKey: movieSectionKey,
            collectionName,
          });
          if (plexCollectionKey) break;
          await sleep(400);
        }
      }

      if (!plexCollectionKey) {
        throw new Error(
          `Failed to find or create Plex collection: ${collectionName}`,
        );
      }

      // A collection created with `uri` can already contain one seed item.
      // A fallback create (without uri) starts empty.
      // Query current items and add only missing desired items.
      let existingKeys = new Set<string>();
      try {
        const itemsAfterCreate = await this.plexServer.getCollectionItems({
          baseUrl,
          token,
          collectionRatingKey: plexCollectionKey,
        });
        existingKeys = new Set(
          itemsAfterCreate
            .map((it) => String(it.ratingKey ?? '').trim())
            .filter(Boolean),
        );
        if (existingKeys.size) {
          await ctx.info('collection: created collection already has items', {
            collectionName,
            existingCount: existingKeys.size,
          });
        }
      } catch (err) {
        await ctx.warn('collection: failed to inspect items after create (continuing)', {
          collectionName,
          plexCollectionKey,
          error: (err as Error)?.message ?? String(err),
        });
      }

      await ctx.info('collection: adding items', {
        collectionName,
        total: desired.length,
      });
      const addTargets = desired.filter((item) => !existingKeys.has(item.ratingKey));
      for (let i = 0; i < addTargets.length; i += 1) {
        const item = addTargets[i];
        if (!item) continue;
        try {
          await this.plexServer.addItemToCollection({
            baseUrl,
            token,
            machineIdentifier,
            collectionRatingKey: plexCollectionKey,
            itemRatingKey: item.ratingKey,
          });
          added += 1;
          existingKeys.add(item.ratingKey);
          lastAddedTitle = item.title || lastAddedTitle;
          if (added % 50 === 0 || i + 1 === addTargets.length) {
            await ctx.info('collection: add progress', {
              collectionName,
              added,
              total: addTargets.length,
            });
            void ctx
              .patchSummary({
                progress: {
                  step: 'plex_collection_add',
                  message: `Adding items to Plex collection: ${collectionName}`,
                  current: added,
                  total: addTargets.length,
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
      // Collection exists: add all desired items (existing items were removed above)
      await ctx.info('collection: adding items to existing collection', {
        collectionName,
        total: desired.length,
      });
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
          lastAddedTitle = item.title || lastAddedTitle;
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

    // Fetch the collection order from Plex (best-effort).
    // Retry until the returned set matches the desired set so report order reflects
    // the final Plex state rather than an eventual-consistency intermediate snapshot.
    collectionItems = desired.map((d) => d.title).filter(Boolean);
    if (plexCollectionKey) {
      let lastErr: unknown = null;
      const desiredKeys = desired.map((d) => d.ratingKey).filter(Boolean);
      const desiredKeySet = new Set(desiredKeys);
      for (let i = 0; i < 10; i += 1) {
        try {
          const ordered = await this.plexServer.getCollectionItems({
            baseUrl,
            token,
            collectionRatingKey: plexCollectionKey,
          });
          const orderedKeys = ordered.map((it) => String(it.ratingKey ?? '')).filter(Boolean);
          const orderedKeySet = new Set(orderedKeys);
          const setsMatch =
            orderedKeys.length === desiredKeySet.size &&
            orderedKeySet.size === desiredKeySet.size &&
            Array.from(desiredKeySet).every((key) => orderedKeySet.has(key));

          if (!setsMatch) {
            await ctx.debug('collection: ordered snapshot not fully settled yet', {
              collectionName,
              plexCollectionKey,
              attempt: i + 1,
              desiredCount: desiredKeySet.size,
              observedCount: orderedKeys.length,
            });
            lastErr = null;
            if (i < 9) await sleep(300);
            continue;
          }

          const titles = ordered
            .map((it) => String(it.title ?? '').trim())
            .filter(Boolean);
          if (titles.length) {
            collectionItems = titles;
            collectionItemsSource = 'plex';
            break;
          }
          lastErr = null;
        } catch (err) {
          lastErr = err;
        }
        if (i < 9) await sleep(300);
      }
      if (lastErr) {
        await ctx.warn('collection: failed to fetch ordered items (continuing)', {
          collectionName,
          plexCollectionKey,
          error: (lastErr as Error)?.message ?? String(lastErr),
        });
      } else if (collectionItemsSource !== 'plex') {
        await ctx.warn(
          'collection: using desired fallback order; Plex ordered snapshot did not settle in time',
          {
            collectionName,
            plexCollectionKey,
            desiredCount: desired.length,
            fallbackCount: collectionItems.length,
          },
        );
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

    // Pin collection hubs (admin or friends target) when there is a material update.
    if (
      pinCollections &&
      plexCollectionKey &&
      (added > 0 || existingCount > 0) &&
      !ctx.dryRun
    ) {
      try {
        await ctx.info('collection: pinning to home/library', {
          collectionName,
          pinTarget,
        });
        await this.pinCuratedCollectionHubs({
          ctx,
          baseUrl,
          token,
          librarySectionKey: movieSectionKey,
          mediaType,
          pinTarget,
          collectionHubOrder:
            collectionHubOrder ?? Array.from(CURATED_MOVIE_COLLECTION_HUB_ORDER),
          preferredHubTargets: [
            ...preferredHubTargets,
            { collectionName, collectionKey: plexCollectionKey },
          ],
        });
      } catch (err) {
        await ctx.warn('collection: failed to pin hubs (non-critical)', {
          collectionName,
          pinTarget,
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
      lastAddedTitle,
      collectionItems,
      collectionItemsSource,
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
    mediaType: 'movie' | 'tv';
    pinTarget: PinTarget;
    collectionHubOrder: string[];
    preferredHubTargets?: PreferredHubTarget[];
  }): Promise<void> {
    const {
      ctx,
      baseUrl,
      token,
      librarySectionKey,
      mediaType,
      pinTarget,
      collectionHubOrder,
      preferredHubTargets = [],
    } = params;

    const requestedOrder = sortCollectionNamesByCuratedBaseOrder({
      collectionNames: collectionHubOrder,
      mediaType,
    });

    const targetVisibility =
      pinTarget === 'friends'
        ? {
            // Non-admin users: pin to Friends' Home + Library Recommended.
            promotedToRecommended: 1,
            promotedToOwnHome: 0,
            promotedToSharedHome: 1,
          }
        : {
            // Admin users: pin to Home + Library Recommended.
            promotedToRecommended: 1,
            promotedToOwnHome: 1,
            promotedToSharedHome: 0,
          };

    const stats = {
      requested: requestedOrder.length,
      found: 0,
      exact: 0,
      preferred: 0,
      fallbackByBase: 0,
      updated: 0,
      missing: 0,
      failed: 0,
    };

    const resolveRequestedUserSuffix = (name: string): string => {
      const match = String(name ?? '')
        .trim()
        .match(/\(([^)]+)\)\s*$/);
      return normalizeCollectionTitle(match?.[1] ?? '');
    };
    type TargetMatch = {
      requestedCollectionName: string;
      matchedCollectionName: string;
      collectionKey: string;
      matchType: 'exact' | 'preferred' | 'base';
    };
    const resolveHubTargets = (allCollections: Array<{ ratingKey: string; title: string }>) => {
      const availableCollections = allCollections
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title));
      const usedCollectionKeys = new Set<string>();
      const targetMatches: TargetMatch[] = [];
      const missingCollections: string[] = [];
      let exact = 0;
      let preferred = 0;
      let fallbackByBase = 0;

      for (const requestedCollectionName of requestedOrder) {
        const normalizedRequested = normalizeCollectionTitle(requestedCollectionName);
        const exactMatch = availableCollections.find((item) => {
          if (!item.ratingKey || usedCollectionKeys.has(item.ratingKey)) return false;
          return normalizeCollectionTitle(item.title) === normalizedRequested;
        });
        if (exactMatch) {
          usedCollectionKeys.add(exactMatch.ratingKey);
          exact += 1;
          targetMatches.push({
            requestedCollectionName,
            matchedCollectionName: exactMatch.title,
            collectionKey: exactMatch.ratingKey,
            matchType: 'exact',
          });
          continue;
        }

        const preferredMatch = preferredHubTargets.find((target) => {
          if (!target.collectionKey || usedCollectionKeys.has(target.collectionKey)) {
            return false;
          }
          const preferredName = String(target.collectionName ?? '').trim();
          if (!preferredName) return false;
          if (
            normalizeCollectionTitle(preferredName) === normalizedRequested
          ) {
            return true;
          }
          return hasSameCuratedCollectionBase({
            left: preferredName,
            right: requestedCollectionName,
            mediaType,
          });
        });
        if (preferredMatch) {
          usedCollectionKeys.add(preferredMatch.collectionKey);
          preferred += 1;
          targetMatches.push({
            requestedCollectionName,
            matchedCollectionName: preferredMatch.collectionName,
            collectionKey: preferredMatch.collectionKey,
            matchType: 'preferred',
          });
          continue;
        }

        const requestedUserSuffix = resolveRequestedUserSuffix(requestedCollectionName);
        const fallbackCandidates = availableCollections.filter((item) => {
          if (!item.ratingKey || usedCollectionKeys.has(item.ratingKey)) return false;
          return hasSameCuratedCollectionBase({
            left: item.title,
            right: requestedCollectionName,
            mediaType,
          });
        });
        const fallback = fallbackCandidates.sort((a, b) => {
          const aSuffix = resolveRequestedUserSuffix(a.title);
          const bSuffix = resolveRequestedUserSuffix(b.title);
          const aUserPriority =
            requestedUserSuffix && aSuffix === requestedUserSuffix ? 0 : 1;
          const bUserPriority =
            requestedUserSuffix && bSuffix === requestedUserSuffix ? 0 : 1;
          if (aUserPriority !== bUserPriority) return aUserPriority - bUserPriority;
          return normalizeCollectionTitle(a.title).localeCompare(
            normalizeCollectionTitle(b.title),
          );
        })[0];

        if (fallback) {
          usedCollectionKeys.add(fallback.ratingKey);
          fallbackByBase += 1;
          targetMatches.push({
            requestedCollectionName,
            matchedCollectionName: fallback.title,
            collectionKey: fallback.ratingKey,
            matchType: 'base',
          });
        } else {
          missingCollections.push(requestedCollectionName);
        }
      }

      return { targetMatches, missingCollections, exact, preferred, fallbackByBase };
    };

    let listAttempt = 0;
    let resolved = resolveHubTargets(
      await this.plexServer.listCollectionsForSectionKey({
        baseUrl,
        token,
        librarySectionKey,
        take: 500,
      }),
    );

    while (resolved.missingCollections.length > 0 && listAttempt < 6) {
      listAttempt += 1;
      await sleep(400);
      resolved = resolveHubTargets(
        await this.plexServer.listCollectionsForSectionKey({
          baseUrl,
          token,
          librarySectionKey,
          take: 500,
        }),
      );
      if (resolved.missingCollections.length === 0) break;
    }

    const targetMatches = resolved.targetMatches;
    const missingCollections = resolved.missingCollections;
    stats.found = targetMatches.length;
    stats.exact = resolved.exact;
    stats.preferred = resolved.preferred;
    stats.fallbackByBase = resolved.fallbackByBase;
    stats.missing = missingCollections.length;

    await ctx.info('hub_pin: resolved target collections', {
      mediaType,
      pinTarget,
      requestedOrder,
      listAttempt,
      matches: targetMatches.map((m) => ({
        requestedCollectionName: m.requestedCollectionName,
        matchedCollectionName: m.matchedCollectionName,
        collectionKey: m.collectionKey,
        matchType: m.matchType,
        baseName: resolveCuratedCollectionBaseName({
          collectionName: m.matchedCollectionName,
          mediaType,
        }),
      })),
      missingCollections,
    });

    for (const target of targetMatches) {
      try {
        await this.plexServer.setCollectionHubVisibility({
          baseUrl,
          token,
          librarySectionKey,
          collectionRatingKey: target.collectionKey,
          promotedToRecommended: targetVisibility.promotedToRecommended,
          promotedToOwnHome: targetVisibility.promotedToOwnHome,
          promotedToSharedHome: targetVisibility.promotedToSharedHome,
        });
        stats.updated += 1;
      } catch (err) {
        stats.failed += 1;
        await ctx.warn('hub_pin: failed updating hub settings', {
          requestedCollectionName: target.requestedCollectionName,
          matchedCollectionName: target.matchedCollectionName,
          pinTarget,
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    try {
      const identifiers: string[] = [];
      const matchedCollections: string[] = [];

      const resolveHubIdentifier = async (collectionKey: string): Promise<string | null> => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const identifier = await this.plexServer
            .getCollectionHubIdentifier({
              baseUrl,
              token,
              librarySectionKey,
              collectionRatingKey: collectionKey,
            })
            .catch(() => null);
          if (identifier) return identifier;
          if (attempt < 7) await sleep(300);
        }
        return null;
      };

      for (const target of targetMatches) {
        try {
          const identifier = await resolveHubIdentifier(target.collectionKey);

          if (identifier) {
            identifiers.push(identifier);
            matchedCollections.push(target.matchedCollectionName);
          } else {
            await ctx.debug('hub_pin: identifier unavailable after retries', {
              requestedCollectionName: target.requestedCollectionName,
              matchedCollectionName: target.matchedCollectionName,
              collectionKey: target.collectionKey,
              pinTarget,
            });
          }
        } catch (err) {
          await ctx.debug('hub_pin: failed to get identifier', {
            requestedCollectionName: target.requestedCollectionName,
            matchedCollectionName: target.matchedCollectionName,
            pinTarget,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }

      if (identifiers.length > 0) {
        // Reorder robustly by moving from bottom->top in reverse desired order.
        // This avoids transient ordering races when chaining `after=` moves.
        for (let i = identifiers.length - 1; i >= 0; i -= 1) {
          await this.plexServer.moveHubRow({
            baseUrl,
            token,
            librarySectionKey,
            identifier: identifiers[i],
            after: null,
          });
          if (i > 0) await sleep(120);
        }

        await ctx.info('hub_pin: reordered top collections', {
          mediaType,
          pinTarget,
          requestedOrder,
          matchedCollections,
          identifiers,
          strategy: 'reverse_to_top',
        });
      }
    } catch (err) {
      await ctx.warn('hub_pin: reorder failed (non-critical)', {
        mediaType,
        pinTarget,
        error: (err as Error)?.message ?? String(err),
      });
    }

    await ctx.info('hub_pin: done', {
      mediaType,
      pinTarget,
      requestedOrder,
      stats,
    });
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
      'inspired by your immaculate taste in movies':
        'immaculate_taste_collection',
      'inspired by your immaculate taste in shows':
        'immaculate_taste_collection',
      'based on your recently watched movie': 'recently_watched_collection',
      'based on your recently watched show': 'recently_watched_collection',
      'change of taste': 'change_of_taste_collection',
      'change of movie taste': 'change_of_taste_collection',
      'change of show taste': 'change_of_taste_collection',
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
