/**
 * Re-export from the canonical shared location.
 * Kept for backward compatibility with any remaining in-tree imports.
 */
export {
  type CollectionOrderableItem,
  type CollectionOrderableItem as ImmaculateOrderableItem,
  shuffleInPlace,
  toReleaseCalendarKey,
  tmdbCalendarDateStringToDate,
  sortByTmdbRating,
  splitThreeTiers,
  pickTopTierIds,
  buildThreeTierOrder,
  buildCollectionOrder,
  buildCollectionOrder as buildImmaculateCollectionOrder,
} from '../collection-ordering.utils';
