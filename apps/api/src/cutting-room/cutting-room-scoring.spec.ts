import {
  type CuttingRoomRules,
  type CuttingRoomScoreInput,
  DEFAULT_CUTTING_ROOM_RULES,
  normalizeCuttingRoomRules,
  scoreCuttingRoomItem,
} from './cutting-room-scoring';

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000; // fixed fake "now"

function baseInput(
  overrides: Partial<CuttingRoomScoreInput> = {},
): CuttingRoomScoreInput {
  return {
    mediaType: 'movie',
    addedAtMs: NOW - 2 * 365 * DAY_MS, // 2 years in library
    everWatched: false,
    lastWatchedMs: null,
    watchedFraction: null,
    rating: null,
    ratingVotes: null,
    ratingMax: null,
    userRating: null,
    monitored: false,
    inArr: true,
    showContinuing: false,
    showEnded: false,
    tagLabels: [],
    librarySectionKey: '1',
    onWatchlist: false,
    onDeck: false,
    recentlyRequested: false,
    inManagedCollection: false,
    watchedByProtectedUser: false,
    ...overrides,
  };
}

function rules(overrides: Partial<CuttingRoomRules> = {}): CuttingRoomRules {
  return normalizeCuttingRoomRules({
    ...(DEFAULT_CUTTING_ROOM_RULES as unknown as Record<string, unknown>),
    ...overrides,
  });
}

describe('cutting room scoring', () => {
  describe('hard protections', () => {
    it('protects items watched within the recency window', () => {
      const result = scoreCuttingRoomItem(
        baseInput({
          everWatched: true,
          lastWatchedMs: NOW - 30 * DAY_MS,
          watchedFraction: 1,
        }),
        rules(),
        NOW,
      );
      expect(result.excluded).toBe(true);
      if (result.excluded) {
        expect(result.protections).toContain('watched_recently');
      }
    });

    it('protects items added within the grace period', () => {
      const result = scoreCuttingRoomItem(
        baseInput({ addedAtMs: NOW - 10 * DAY_MS }),
        rules(),
        NOW,
      );
      expect(result.excluded).toBe(true);
      if (result.excluded) expect(result.protections).toContain('too_new');
    });

    it('protects deselected/protected libraries', () => {
      const result = scoreCuttingRoomItem(
        baseInput({ librarySectionKey: '9' }),
        rules({ protectedSectionKeys: ['9'] }),
        NOW,
      );
      expect(result.excluded).toBe(true);
      if (result.excluded) {
        expect(result.protections).toContain('protected_library');
      }
    });

    it('protects user-chosen arr tags', () => {
      const result = scoreCuttingRoomItem(
        baseInput({ tagLabels: ['curated'] }),
        rules({ protectedTagLabels: ['curated'] }),
        NOW,
      );
      expect(result.excluded).toBe(true);
      if (result.excluded) {
        expect(result.protections).toContain('protected_tag');
      }
    });

    it('protects monitored airing shows', () => {
      const result = scoreCuttingRoomItem(
        baseInput({
          mediaType: 'show',
          monitored: true,
          showContinuing: true,
        }),
        rules(),
        NOW,
      );
      expect(result.excluded).toBe(true);
      if (result.excluded) {
        expect(result.protections).toContain('monitored_airing');
      }
    });

    it('protects watchlist, on-deck, requested, and managed-collection items', () => {
      for (const [field, code] of [
        ['onWatchlist', 'on_watchlist'],
        ['onDeck', 'on_deck'],
        ['recentlyRequested', 'recently_requested'],
        ['inManagedCollection', 'in_managed_collection'],
      ] as const) {
        const result = scoreCuttingRoomItem(
          baseInput({ [field]: true } as Partial<CuttingRoomScoreInput>),
          rules(),
          NOW,
        );
        expect(result.excluded).toBe(true);
        if (result.excluded) expect(result.protections).toContain(code);
      }
    });

    it('protects items watched by a protected Plex user', () => {
      const result = scoreCuttingRoomItem(
        baseInput({ watchedByProtectedUser: true }),
        rules(),
        NOW,
      );
      expect(result.excluded).toBe(true);
      if (result.excluded) {
        expect(result.protections).toContain('watched_by_protected_user');
      }
    });
  });

  describe('never-watched scoring', () => {
    it('accumulates age points capped at 3 years', () => {
      const twoYears = scoreCuttingRoomItem(baseInput(), rules(), NOW);
      expect(twoYears.excluded).toBe(false);
      if (!twoYears.excluded) expect(twoYears.score).toBeGreaterThanOrEqual(50);

      const tenYears = scoreCuttingRoomItem(
        baseInput({ addedAtMs: NOW - 10 * 365 * DAY_MS }),
        rules({
          factors: {
            ...DEFAULT_CUTTING_ROOM_RULES.factors,
            lowRating: false,
            provenanceTags: false,
            unmonitored: false,
            endedShow: false,
          },
        }),
        NOW,
      );
      if (!tenYears.excluded) expect(tenYears.score).toBe(75); // 3y cap * 25
    });

    it('scores ratings on a smooth scale (no threshold cliffs)', () => {
      const points = (rating: number) => {
        const result = scoreCuttingRoomItem(
          baseInput({ rating }),
          rules(),
          NOW,
        );
        if (result.excluded) throw new Error('unexpected exclusion');
        return result.reasons.find((r) => r.code === 'low_rating')?.points ?? 0;
      };
      // anchor 6.0 (penalty threshold), slope 10, cap 25 (movies)
      expect(points(6.0)).toBe(0); // decent titles add nothing
      expect(points(6.8)).toBe(0); // well-regarded adds nothing
      expect(points(5.0)).toBe(10);
      expect(points(4.0)).toBe(20);
      expect(points(3.0)).toBe(25); // capped
      // No cliff: 5.9 vs 6.1 differ by ~1 point, not 15.
      expect(Math.abs(points(5.9) - points(6.1))).toBeLessThanOrEqual(2);
    });

    it('shrinks low-vote ratings toward the anchor (vote confidence)', () => {
      const points = (rating: number, ratingVotes: number | null) => {
        const result = scoreCuttingRoomItem(
          baseInput({ rating, ratingVotes }),
          rules(),
          NOW,
        );
        if (result.excluded) throw new Error('unexpected exclusion');
        return result.reasons.find((r) => r.code === 'low_rating')?.points ?? 0;
      };
      const fewVotes = points(4.2, 50); // eff ≈ 5.74 → ~3
      const manyVotes = points(4.2, 5000); // eff ≈ 4.30 → ~17
      expect(fewVotes).toBeLessThanOrEqual(4);
      expect(manyVotes).toBeGreaterThanOrEqual(17);
      expect(manyVotes).toBeGreaterThan(fewVotes);
      // Unknown votes → raw rating is used.
      expect(points(4.2, null)).toBe(Math.round((6.0 - 4.2) * 10));
      // Votes chip label mentions the count.
      const result = scoreCuttingRoomItem(
        baseInput({ rating: 4.2, ratingVotes: 48000 }),
        rules(),
        NOW,
      );
      if (!result.excluded) {
        const chip = result.reasons.find((r) => r.code === 'low_rating');
        expect(chip?.label).toContain('48k votes');
      }
    });

    it('never penalizes highly-regarded titles (any source ≥ 7.5)', () => {
      const result = scoreCuttingRoomItem(
        // Blend dragged to 5.2 by a divergent source, but IMDb says 7.8.
        baseInput({ rating: 5.2, ratingVotes: 20000, ratingMax: 7.8 }),
        rules(),
        NOW,
      );
      expect(result.excluded).toBe(false);
      if (!result.excluded) {
        const codes = result.reasons.map((r) => r.code);
        expect(codes).not.toContain('low_rating');
      }
    });

    it('boosts items the user personally rated low', () => {
      const result = scoreCuttingRoomItem(
        baseInput({ userRating: 2 }),
        rules(),
        NOW,
      );
      expect(result.excluded).toBe(false);
      if (!result.excluded) {
        const chip = result.reasons.find(
          (r) => r.code === 'personal_low_rating',
        );
        expect(chip?.points).toBe(30);
        expect(chip?.label).toContain('2★');
      }
    });

    it('protects items the user personally rated highly, even with lowRating off', () => {
      const result = scoreCuttingRoomItem(
        baseInput({ userRating: 9 }),
        rules({
          factors: { ...DEFAULT_CUTTING_ROOM_RULES.factors, lowRating: false },
        }),
        NOW,
      );
      expect(result.excluded).toBe(true);
      if (result.excluded) {
        expect(result.protections).toContain('personal_high_rating');
      }
    });

    it('adds provenance tag points', () => {
      const result = scoreCuttingRoomItem(
        baseInput({ tagLabels: ['guest', 'imdb', 'change-of-taste'] }),
        rules(),
        NOW,
      );
      expect(result.excluded).toBe(false);
      if (!result.excluded) {
        const codes = result.reasons.map((r) => r.code);
        expect(codes).toEqual(
          expect.arrayContaining([
            'guest_request',
            'list_import',
            'change_of_taste',
          ]),
        );
      }
    });

    it('respects factor toggles', () => {
      const result = scoreCuttingRoomItem(
        baseInput({ rating: 3.0, tagLabels: ['guest'] }),
        rules({
          factors: {
            ...DEFAULT_CUTTING_ROOM_RULES.factors,
            lowRating: false,
            provenanceTags: false,
            unmonitored: false,
          },
        }),
        NOW,
      );
      expect(result.excluded).toBe(false);
      if (!result.excluded) {
        const codes = result.reasons.map((r) => r.code);
        expect(codes).not.toContain('low_rating');
        expect(codes).not.toContain('guest_request');
        expect(codes).not.toContain('unmonitored');
      }
    });

    it('assigns tier 1 only to old high-scoring items', () => {
      const t1 = scoreCuttingRoomItem(
        baseInput({ rating: 4.0, addedAtMs: NOW - 2 * 365 * DAY_MS }),
        rules(),
        NOW,
      );
      if (!t1.excluded) expect(t1.tier).toBe(1);

      const young = scoreCuttingRoomItem(
        baseInput({ rating: 4.0, addedAtMs: NOW - 200 * DAY_MS }),
        rules(),
        NOW,
      );
      if (!young.excluded) expect(young.tier).toBe(2);

      const veryYoung = scoreCuttingRoomItem(
        baseInput({ rating: 4.0, addedAtMs: NOW - 120 * DAY_MS }),
        rules(),
        NOW,
      );
      if (!veryYoung.excluded) expect(veryYoung.tier).toBe(3);
    });
  });

  describe('watched items', () => {
    it('flags abandoned partials as tier 3', () => {
      const result = scoreCuttingRoomItem(
        baseInput({
          everWatched: true,
          watchedFraction: 0.1,
          lastWatchedMs: NOW - 400 * DAY_MS,
        }),
        rules(),
        NOW,
      );
      expect(result.excluded).toBe(false);
      if (!result.excluded) {
        expect(result.tier).toBe(3);
        expect(result.watchStatus).toBe('abandoned');
      }
    });

    it('keeps fully-watched items unless watchedLongAgo factor is on', () => {
      const input = baseInput({
        everWatched: true,
        watchedFraction: 1,
        lastWatchedMs: NOW - 600 * DAY_MS,
      });

      const off = scoreCuttingRoomItem(input, rules(), NOW);
      expect(off.excluded).toBe(true);

      const on = scoreCuttingRoomItem(
        input,
        rules({
          factors: {
            ...DEFAULT_CUTTING_ROOM_RULES.factors,
            watchedLongAgo: true,
          },
        }),
        NOW,
      );
      expect(on.excluded).toBe(false);
      if (!on.excluded) {
        expect(on.tier).toBe(4);
        expect(on.watchStatus).toBe('watched');
      }
    });
  });

  describe('normalizeCuttingRoomRules', () => {
    it('returns defaults for garbage input', () => {
      expect(normalizeCuttingRoomRules(null)).toEqual(
        DEFAULT_CUTTING_ROOM_RULES,
      );
      expect(normalizeCuttingRoomRules('nope')).toEqual(
        DEFAULT_CUTTING_ROOM_RULES,
      );
      expect(normalizeCuttingRoomRules(42)).toEqual(DEFAULT_CUTTING_ROOM_RULES);
    });

    it('lowercases protected tags and the prune tag', () => {
      const normalized = normalizeCuttingRoomRules({
        protectedTagLabels: [' Curated ', 'KIDS'],
        pruneTagLabel: 'Immaculaterr-PRUNED',
      });
      expect(normalized.protectedTagLabels).toEqual(['curated', 'kids']);
      expect(normalized.pruneTagLabel).toBe('immaculaterr-pruned');
    });

    it('clamps out-of-range values', () => {
      const normalized = normalizeCuttingRoomRules({
        maxItemsPerRun: -5,
        abandonedMaxFraction: 7,
      });
      expect(normalized.maxItemsPerRun).toBeGreaterThanOrEqual(1);
      expect(normalized.abandonedMaxFraction).toBeLessThanOrEqual(1);
    });

    it('defaults the large-files factor off and clamps its threshold', () => {
      const defaults = normalizeCuttingRoomRules({});
      expect(defaults.factors.largeFiles).toBe(false);
      expect(defaults.largeFilesThresholdGb).toBe(10);
      const custom = normalizeCuttingRoomRules({
        factors: { largeFiles: true },
        largeFilesThresholdGb: 0,
      });
      expect(custom.factors.largeFiles).toBe(true);
      expect(custom.largeFilesThresholdGb).toBeGreaterThanOrEqual(1);
    });

    it('ignores stored rating-curve values so old installs get engine updates', () => {
      const normalized = normalizeCuttingRoomRules({
        rating: {
          anchorMovie: 7.0,
          anchorShow: 7.2,
          slopeMovie: 7,
          slopeShow: 5,
          votesK: 50,
          regardedMin: 99,
        },
      });
      expect(normalized.rating).toEqual(DEFAULT_CUTTING_ROOM_RULES.rating);
    });
  });
});
