/**
 * Pure scoring/tiering logic for the Cutting Room feature.
 *
 * Answers one question per item: "how unlikely is it that anyone on this
 * server ever watches this?" — via hard protections first, then an additive
 * score over user-selected factors. Every factor that fires emits a
 * human-readable reason chip so the UI can explain each candidate.
 *
 * No I/O and no clock access here: callers pass `nowMs` explicitly, which
 * keeps every path deterministic and unit-testable.
 */

export type CuttingRoomRatingConfig = {
  /**
   * Penalty threshold: only ratings BELOW this add points. Decent (6-7) and
   * good titles add nothing — the factor targets genuinely low-rated media.
   */
  anchorMovie: number;
  anchorShow: number;
  /** Points per rating-point below the anchor. */
  slopeMovie: number;
  slopeShow: number;
  capMovie: number;
  capShow: number;
  /** Vote-confidence shrinkage constant (IMDb-style weighted rating). */
  votesK: number;
  /**
   * Highly-regarded exemption: if ANY rating source (IMDb/TMDB/Plex audience)
   * is at/above this, the item never gets low-rating points — protects
   * well-regarded titles from being dragged down by one divergent source.
   */
  regardedMin: number;
  /** Personal Plex star-rating at/below this adds personalLowPoints. */
  personalLowMax: number;
  personalLowPoints: number;
  /** Personal Plex star-rating at/above this hard-protects the item. */
  personalProtectMin: number;
};

export type CuttingRoomFactorToggles = {
  /** Rating-based boosts (low/very-low/unrated). */
  lowRating: boolean;
  /** Provenance tags: guest requests, list imports, change-of-taste. */
  provenanceTags: boolean;
  /** Items the user already unmonitored in Radarr/Sonarr. */
  unmonitored: boolean;
  /** Shows that ended (no new episodes coming). */
  endedShow: boolean;
  /** Include the abandoned-partials tier (started, quit, stale). */
  abandoned: boolean;
  /**
   * Oversized-file replacement mode. Exclusive: when on, the wizard runs the
   * large-file replacement flow instead of prune scoring, so no other factor
   * applies. Never consumed by the scoring engine.
   */
  largeFiles: boolean;
  /** Include the watched-long-ago tier (rewatch risk — most conservative). */
  watchedLongAgo: boolean;
};

export type CuttingRoomRules = {
  /** Gate the analyze/prune flow on a configured Tautulli integration. */
  requireTautulli: boolean;
  /** Anything watched within this window is protected. */
  recencyWindowDays: number;
  /** Anything added within this window is protected (too new to judge). */
  graceDays: number;
  /** Arr tag labels (lowercase) that protect an item, e.g. "curated". */
  protectedTagLabels: string[];
  /** Plex section keys excluded from candidacy entirely. */
  protectedSectionKeys: string[];
  /** Plex account ids whose watch history protects items. */
  protectedPlexUserIds: string[];
  protectWatchlist: boolean;
  protectOnDeck: boolean;
  protectSeerrRequests: boolean;
  seerrRequestWindowDays: number;
  protectManagedCollections: boolean;
  /** Allow deleting items Plex knows but no arr tracks (via Plex API). */
  allowPlexOnlyDeletes: boolean;
  /** Tag applied in Radarr/Sonarr to pruned entries. */
  pruneTagLabel: string;
  /** Tag applied to items whose oversized file was replaced. */
  sizeReductionTagLabel: string;
  /** Default "oversized" threshold for the large-file replacement flow, in GB. */
  largeFilesThresholdGb: number;
  maxItemsPerRun: number;
  maxBytesPerRun: number;
  /** Abandoned = watched fraction <= this AND stale beyond abandonedStaleDays. */
  abandonedMaxFraction: number;
  abandonedStaleDays: number;
  /** Fully-watched items older than this become tier-4 candidates. */
  watchedLongAgoDays: number;
  /** Never-watched items older than this can reach tier 1. */
  tier1MinAgeDays: number;
  tier1MinScore: number;
  /** Never-watched items younger than this land in tier 3 (low confidence). */
  tier2MinAgeDays: number;
  rating: CuttingRoomRatingConfig;
  factors: CuttingRoomFactorToggles;
};

export const DEFAULT_CUTTING_ROOM_RULES: CuttingRoomRules = {
  requireTautulli: false,
  recencyWindowDays: 365,
  graceDays: 90,
  protectedTagLabels: ['deleted-by-immaculaterr'],
  protectedSectionKeys: [],
  protectedPlexUserIds: [],
  protectWatchlist: true,
  protectOnDeck: true,
  protectSeerrRequests: true,
  seerrRequestWindowDays: 180,
  protectManagedCollections: true,
  allowPlexOnlyDeletes: false,
  pruneTagLabel: 'deleted-by-immaculaterr',
  sizeReductionTagLabel: 'size-reduction',
  largeFilesThresholdGb: 10,
  maxItemsPerRun: 500,
  maxBytesPerRun: 5_000_000_000_000,
  abandonedMaxFraction: 0.25,
  abandonedStaleDays: 365,
  watchedLongAgoDays: 540,
  tier1MinAgeDays: 540,
  tier1MinScore: 60,
  tier2MinAgeDays: 180,
  rating: {
    anchorMovie: 6.0,
    anchorShow: 6.2,
    slopeMovie: 10,
    slopeShow: 8,
    capMovie: 25,
    capShow: 20,
    votesK: 300,
    regardedMin: 7.5,
    personalLowMax: 4,
    personalLowPoints: 30,
    personalProtectMin: 8,
  },
  factors: {
    lowRating: true,
    provenanceTags: true,
    unmonitored: true,
    endedShow: true,
    abandoned: true,
    largeFiles: false,
    watchedLongAgo: false,
  },
};

/** Provenance tag labels recognized by the provenance factor (lowercase). */
export const PROVENANCE_TAGS = {
  guest: ['guest'],
  listImport: ['imdb', 'list-import', 'trakt'],
  changeOfTaste: ['change-of-taste'],
} as const;

export type CuttingRoomReason = {
  code: string;
  label: string;
  points: number;
};

export type CuttingRoomScoreInput = {
  mediaType: 'movie' | 'show';
  /** Epoch ms the item was added to the library; null = unknown. */
  addedAtMs: number | null;
  everWatched: boolean;
  /** Epoch ms of the most recent play by anyone; null = never/unknown. */
  lastWatchedMs: number | null;
  /**
   * Fraction watched: movies = viewOffset progress (0..1) when partially
   * played; shows = viewedLeafCount / leafCount. Null = unknown.
   */
  watchedFraction: number | null;
  rating: number | null;
  /** Vote count backing `rating` when known (IMDb/TMDB/Sonarr votes). */
  ratingVotes: number | null;
  /** Highest single-source rating (IMDb/TMDB/Plex audience), for the regarded exemption. */
  ratingMax: number | null;
  /** The user's own Plex star-rating (0-10 scale), when set. */
  userRating: number | null;
  /** Monitored flag from the arr; null when the item is not tracked. */
  monitored: boolean | null;
  inArr: boolean;
  /** True when the arr reports the show still airing ("continuing"). */
  showContinuing: boolean;
  showEnded: boolean;
  /** Lowercased arr tag labels on the item. */
  tagLabels: string[];
  librarySectionKey: string;
  onWatchlist: boolean;
  onDeck: boolean;
  /** Requested via Seerr within rules.seerrRequestWindowDays. */
  recentlyRequested: boolean;
  inManagedCollection: boolean;
  /** Watched by a protected Plex user (any time). */
  watchedByProtectedUser: boolean;
};

export type CuttingRoomScoreResult =
  | { excluded: true; protections: string[] }
  | {
      excluded: false;
      score: number;
      tier: 1 | 2 | 3 | 4;
      watchStatus: 'never' | 'abandoned' | 'watched';
      reasons: CuttingRoomReason[];
    };

const DAY_MS = 86_400_000;

/**
 * Aggregate-rating points on a smooth scale with vote-confidence shrinkage.
 * Only genuinely low ratings (below the anchor threshold) add points — decent
 * and good titles add zero. Two extra guards keep popular/highly-regarded
 * media out entirely:
 * - `ratingMax` exemption: if ANY source rates the title at/above
 *   `regardedMin`, it is never penalized (one divergent source can't drag a
 *   well-regarded film into the penalty zone).
 * - Vote shrinkage: low-vote ratings shrink toward the anchor, so obscure
 *   titles with a handful of votes are barely penalized while well-voted junk
 *   scores the full penalty.
 */
export function aggregateRatingPoints(
  mediaType: 'movie' | 'show',
  rating: number,
  votes: number | null,
  ratingMax: number | null,
  config: CuttingRoomRatingConfig,
): number {
  if (ratingMax !== null && ratingMax >= config.regardedMin) return 0;
  const anchor = mediaType === 'movie' ? config.anchorMovie : config.anchorShow;
  const slope = mediaType === 'movie' ? config.slopeMovie : config.slopeShow;
  const cap = mediaType === 'movie' ? config.capMovie : config.capShow;
  const effective =
    votes !== null && votes > 0
      ? (rating * votes + anchor * config.votesK) / (votes + config.votesK)
      : rating;
  return Math.max(0, Math.min(cap, Math.round((anchor - effective) * slope)));
}

function formatVotes(votes: number): string {
  return votes >= 1000
    ? `${Math.round(votes / 1000)}k votes`
    : `${votes} votes`;
}

export function collectProtections(
  input: CuttingRoomScoreInput,
  rules: CuttingRoomRules,
  nowMs: number,
): string[] {
  const protections: string[] = [];

  if (rules.protectedSectionKeys.includes(input.librarySectionKey)) {
    protections.push('protected_library');
  }
  if (
    input.everWatched &&
    input.lastWatchedMs !== null &&
    nowMs - input.lastWatchedMs < rules.recencyWindowDays * DAY_MS
  ) {
    protections.push('watched_recently');
  }
  if (
    input.addedAtMs !== null &&
    nowMs - input.addedAtMs < rules.graceDays * DAY_MS
  ) {
    protections.push('too_new');
  }
  if (
    rules.protectedTagLabels.length > 0 &&
    input.tagLabels.some((t) => rules.protectedTagLabels.includes(t))
  ) {
    protections.push('protected_tag');
  }
  if (
    input.mediaType === 'show' &&
    input.monitored === true &&
    input.showContinuing
  ) {
    protections.push('monitored_airing');
  }
  if (rules.protectWatchlist && input.onWatchlist) {
    protections.push('on_watchlist');
  }
  if (rules.protectOnDeck && input.onDeck) {
    protections.push('on_deck');
  }
  if (rules.protectSeerrRequests && input.recentlyRequested) {
    protections.push('recently_requested');
  }
  if (rules.protectManagedCollections && input.inManagedCollection) {
    protections.push('in_managed_collection');
  }
  if (input.watchedByProtectedUser) {
    protections.push('watched_by_protected_user');
  }
  if (
    input.userRating !== null &&
    input.userRating >= rules.rating.personalProtectMin
  ) {
    protections.push('personal_high_rating');
  }

  return protections;
}

export function scoreCuttingRoomItem(
  input: CuttingRoomScoreInput,
  rules: CuttingRoomRules,
  nowMs: number,
): CuttingRoomScoreResult {
  const protections = collectProtections(input, rules, nowMs);
  if (protections.length > 0) {
    return { excluded: true, protections };
  }

  const ageDays =
    input.addedAtMs !== null ? (nowMs - input.addedAtMs) / DAY_MS : 0;
  const ageYears = ageDays / 365;
  const reasons: CuttingRoomReason[] = [];
  const factors = rules.factors;

  if (!input.everWatched) {
    let score = 0;

    const agePoints = Math.round(Math.min(ageYears, 3) * 25);
    if (agePoints > 0) {
      score += agePoints;
      reasons.push({
        code: 'never_watched',
        label: `never watched · ${ageYears.toFixed(1)}y in library`,
        points: agePoints,
      });
    } else {
      reasons.push({
        code: 'never_watched',
        label: 'never watched',
        points: 0,
      });
    }

    if (factors.lowRating) {
      // Personal verdict first: the user's own low star-rating outranks
      // any aggregate score.
      if (
        input.userRating !== null &&
        input.userRating <= rules.rating.personalLowMax
      ) {
        score += rules.rating.personalLowPoints;
        reasons.push({
          code: 'personal_low_rating',
          label: `you rated it ${input.userRating.toFixed(0)}★`,
          points: rules.rating.personalLowPoints,
        });
      }

      if (input.rating === null) {
        score += 5;
        reasons.push({ code: 'unrated', label: 'no rating', points: 5 });
      } else {
        const points = aggregateRatingPoints(
          input.mediaType,
          input.rating,
          input.ratingVotes,
          input.ratingMax,
          rules.rating,
        );
        if (points > 0) {
          score += points;
          reasons.push({
            code: 'low_rating',
            label:
              input.ratingVotes !== null && input.ratingVotes > 0
                ? `rated ${input.rating.toFixed(1)} · ${formatVotes(input.ratingVotes)}`
                : `rated ${input.rating.toFixed(1)}`,
            points,
          });
        }
      }
    }

    if (factors.provenanceTags) {
      const tags = input.tagLabels;
      if (PROVENANCE_TAGS.guest.some((t) => tags.includes(t))) {
        score += 20;
        reasons.push({
          code: 'guest_request',
          label: 'guest request',
          points: 20,
        });
      }
      if (PROVENANCE_TAGS.listImport.some((t) => tags.includes(t))) {
        score += 10;
        reasons.push({
          code: 'list_import',
          label: 'list import',
          points: 10,
        });
      }
      if (PROVENANCE_TAGS.changeOfTaste.some((t) => tags.includes(t))) {
        score += 40;
        reasons.push({
          code: 'change_of_taste',
          label: 'change of taste',
          points: 40,
        });
      }
    }

    if (factors.unmonitored && input.monitored === false) {
      const points = input.mediaType === 'movie' ? 10 : 12;
      score += points;
      reasons.push({ code: 'unmonitored', label: 'unmonitored', points });
    }

    if (!input.inArr) {
      score += 8;
      reasons.push({
        code: 'not_in_arr',
        label: input.mediaType === 'movie' ? 'not in Radarr' : 'not in Sonarr',
        points: 8,
      });
    }

    if (factors.endedShow && input.mediaType === 'show' && input.showEnded) {
      score += 8;
      reasons.push({ code: 'show_ended', label: 'show ended', points: 8 });
    }

    let tier: 1 | 2 | 3;
    if (ageDays >= rules.tier1MinAgeDays && score >= rules.tier1MinScore) {
      tier = 1;
    } else if (ageDays >= rules.tier2MinAgeDays) {
      tier = 2;
    } else {
      tier = 3;
    }
    return { excluded: false, score, tier, watchStatus: 'never', reasons };
  }

  const staleMs =
    input.lastWatchedMs !== null ? nowMs - input.lastWatchedMs : null;

  if (
    factors.abandoned &&
    input.watchedFraction !== null &&
    input.watchedFraction > 0 &&
    input.watchedFraction <= rules.abandonedMaxFraction &&
    staleMs !== null &&
    staleMs >= rules.abandonedStaleDays * DAY_MS
  ) {
    const staleYears = staleMs / DAY_MS / 365;
    const score = 40 + Math.round(Math.min(ageYears, 3) * 10);
    return {
      excluded: false,
      score,
      tier: 3,
      watchStatus: 'abandoned',
      reasons: [
        {
          code: 'abandoned',
          label: `abandoned at ${(input.watchedFraction * 100).toFixed(0)}% · idle ${staleYears.toFixed(1)}y`,
          points: score,
        },
      ],
    };
  }

  if (
    factors.watchedLongAgo &&
    staleMs !== null &&
    staleMs >= rules.watchedLongAgoDays * DAY_MS
  ) {
    return {
      excluded: false,
      score: 25,
      tier: 4,
      watchStatus: 'watched',
      reasons: [
        {
          code: 'watched_long_ago',
          label: `last watched ${(staleMs / DAY_MS / 365).toFixed(1)}y ago`,
          points: 25,
        },
      ],
    };
  }

  return { excluded: true, protections: ['watched'] };
}

/** Human labels for protection codes (UI chips + snapshot aggregates). */
export function normalizeCuttingRoomRules(value: unknown): CuttingRoomRules {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const base = DEFAULT_CUTTING_ROOM_RULES;

  const num = (key: keyof CuttingRoomRules, fallback: number): number => {
    const v = raw[key as string];
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const bool = (key: keyof CuttingRoomRules, fallback: boolean): boolean => {
    const v = raw[key as string];
    return typeof v === 'boolean' ? v : fallback;
  };
  const strArray = (key: keyof CuttingRoomRules): string[] => {
    const v = raw[key as string];
    if (!Array.isArray(v)) return [];
    return v
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  };

  const factorsRaw =
    raw['factors'] && typeof raw['factors'] === 'object'
      ? (raw['factors'] as Record<string, unknown>)
      : {};
  const factor = (key: keyof CuttingRoomFactorToggles): boolean => {
    const v = factorsRaw[key];
    return typeof v === 'boolean' ? v : base.factors[key];
  };

  const pruneTagRaw = raw['pruneTagLabel'];
  const pruneTagLabel =
    typeof pruneTagRaw === 'string' && pruneTagRaw.trim()
      ? pruneTagRaw.trim().toLowerCase()
      : base.pruneTagLabel;
  const sizeTagRaw = raw['sizeReductionTagLabel'];
  const sizeReductionTagLabel =
    typeof sizeTagRaw === 'string' && sizeTagRaw.trim()
      ? sizeTagRaw.trim().toLowerCase()
      : base.sizeReductionTagLabel;

  return {
    requireTautulli: bool('requireTautulli', base.requireTautulli),
    recencyWindowDays: num('recencyWindowDays', base.recencyWindowDays),
    graceDays: num('graceDays', base.graceDays),
    // Missing key → seed the default protected tag; an explicit array
    // (even empty — the user deleted every pill) is respected as-is.
    protectedTagLabels: Array.isArray(raw['protectedTagLabels'])
      ? strArray('protectedTagLabels')
      : [...base.protectedTagLabels],
    protectedSectionKeys: (Array.isArray(raw['protectedSectionKeys'])
      ? (raw['protectedSectionKeys'] as unknown[])
      : []
    )
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    protectedPlexUserIds: (Array.isArray(raw['protectedPlexUserIds'])
      ? (raw['protectedPlexUserIds'] as unknown[])
      : []
    )
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0),
    protectWatchlist: bool('protectWatchlist', base.protectWatchlist),
    protectOnDeck: bool('protectOnDeck', base.protectOnDeck),
    protectSeerrRequests: bool(
      'protectSeerrRequests',
      base.protectSeerrRequests,
    ),
    seerrRequestWindowDays: num(
      'seerrRequestWindowDays',
      base.seerrRequestWindowDays,
    ),
    protectManagedCollections: bool(
      'protectManagedCollections',
      base.protectManagedCollections,
    ),
    allowPlexOnlyDeletes: bool(
      'allowPlexOnlyDeletes',
      base.allowPlexOnlyDeletes,
    ),
    pruneTagLabel,
    sizeReductionTagLabel,
    largeFilesThresholdGb: Math.max(
      1,
      num('largeFilesThresholdGb', base.largeFilesThresholdGb),
    ),
    maxItemsPerRun: Math.max(1, num('maxItemsPerRun', base.maxItemsPerRun)),
    maxBytesPerRun: Math.max(
      1_000_000,
      num('maxBytesPerRun', base.maxBytesPerRun),
    ),
    abandonedMaxFraction: Math.min(
      1,
      Math.max(0, num('abandonedMaxFraction', base.abandonedMaxFraction)),
    ),
    abandonedStaleDays: num('abandonedStaleDays', base.abandonedStaleDays),
    watchedLongAgoDays: num('watchedLongAgoDays', base.watchedLongAgoDays),
    tier1MinAgeDays: num('tier1MinAgeDays', base.tier1MinAgeDays),
    tier1MinScore: num('tier1MinScore', base.tier1MinScore),
    tier2MinAgeDays: num('tier2MinAgeDays', base.tier2MinAgeDays),
    // The rating curve is engine-owned, never user-tunable: stored values from
    // older engine versions must not pin existing installs to a stale curve.
    rating: { ...base.rating },
    factors: {
      lowRating: factor('lowRating'),
      provenanceTags: factor('provenanceTags'),
      unmonitored: factor('unmonitored'),
      endedShow: factor('endedShow'),
      abandoned: factor('abandoned'),
      largeFiles: factor('largeFiles'),
      watchedLongAgo: factor('watchedLongAgo'),
    },
  };
}
