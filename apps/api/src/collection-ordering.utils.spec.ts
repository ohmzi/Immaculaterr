import {
  buildCollectionOrder,
  buildThreeTierOrder,
  tmdbCalendarDateStringToDate,
  toReleaseCalendarKey,
} from './collection-ordering.utils';

describe('collection-ordering.utils', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('toReleaseCalendarKey', () => {
    it('trims and preserves plain calendar-date strings', () => {
      expect(toReleaseCalendarKey(' 2026-04-06 ')).toBe('2026-04-06');
    });

    it('normalizes valid Date objects to UTC calendar keys', () => {
      expect(toReleaseCalendarKey(new Date('2026-04-06T18:30:00.000Z'))).toBe(
        '2026-04-06',
      );
    });

    it('returns null for invalid date-like values', () => {
      expect(toReleaseCalendarKey('not-a-date')).toBeNull();
      expect(toReleaseCalendarKey(new Date('invalid'))).toBeNull();
    });
  });

  describe('tmdbCalendarDateStringToDate', () => {
    it('converts TMDB date strings to a stable UTC-noon Date', () => {
      expect(tmdbCalendarDateStringToDate('2026-04-06')?.toISOString()).toBe(
        '2026-04-06T12:00:00.000Z',
      );
    });

    it('returns null for malformed calendar dates', () => {
      expect(tmdbCalendarDateStringToDate('2026/04/06')).toBeNull();
    });
  });

  describe('buildThreeTierOrder', () => {
    it('deduplicates repeated ids before ordering', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const order = buildThreeTierOrder({
        items: [
          {
            id: 1,
            tmdbVoteAvg: 9.2,
            tmdbVoteCount: 100,
            releaseDate: '2026-01-01',
          },
          {
            id: 1,
            tmdbVoteAvg: 9.2,
            tmdbVoteCount: 100,
            releaseDate: '2026-01-01',
          },
          {
            id: 2,
            tmdbVoteAvg: 8.5,
            tmdbVoteCount: 70,
            releaseDate: '2025-01-01',
          },
          {
            id: 3,
            tmdbVoteAvg: 7.4,
            tmdbVoteCount: 30,
            releaseDate: '2024-01-01',
          },
        ],
      });

      expect(order).toHaveLength(3);
      expect(new Set(order)).toEqual(new Set([1, 2, 3]));
    });
  });

  describe('buildCollectionOrder', () => {
    it('prioritizes an unwatched current-year title for the first slot', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const order = buildCollectionOrder({
        now: new Date('2026-08-15T00:00:00.000Z'),
        watchedIds: new Set([2]),
        items: [
          {
            id: 1,
            tmdbVoteAvg: 9.5,
            tmdbVoteCount: 100,
            releaseDate: '2026-02-10',
          },
          {
            id: 2,
            tmdbVoteAvg: 8.8,
            tmdbVoteCount: 80,
            releaseDate: '2026-03-15',
          },
          {
            id: 3,
            tmdbVoteAvg: 8.1,
            tmdbVoteCount: 60,
            releaseDate: '2025-12-01',
          },
          {
            id: 4,
            tmdbVoteAvg: 7.2,
            tmdbVoteCount: 40,
            releaseDate: '2024-01-01',
          },
        ],
      });

      expect(order[0]).toBe(1);
      expect(new Set(order)).toEqual(new Set([1, 2, 3, 4]));
    });

    it('falls back to recent releases when no current-year candidate exists', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const order = buildCollectionOrder({
        now: new Date('2026-08-15T00:00:00.000Z'),
        recentReleaseMonths: 12,
        items: [
          {
            id: 1,
            tmdbVoteAvg: 7.5,
            tmdbVoteCount: 30,
            releaseDate: '2024-01-10',
          },
          {
            id: 2,
            tmdbVoteAvg: 8.4,
            tmdbVoteCount: 50,
            releaseDate: '2025-12-01',
          },
          {
            id: 3,
            tmdbVoteAvg: 7.1,
            tmdbVoteCount: 25,
            releaseDate: '2024-03-01',
          },
        ],
      });

      expect(order[0]).toBe(2);
      expect(new Set(order)).toEqual(new Set([1, 2, 3]));
    });

    it('falls back to three-tier ordering when no recent lead candidate exists', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const items = [
        {
          id: 1,
          tmdbVoteAvg: 9.1,
          tmdbVoteCount: 90,
          releaseDate: '2024-01-01',
        },
        {
          id: 2,
          tmdbVoteAvg: 8.7,
          tmdbVoteCount: 70,
          releaseDate: '2023-05-01',
        },
        {
          id: 3,
          tmdbVoteAvg: 7.9,
          tmdbVoteCount: 40,
          releaseDate: '2022-08-01',
        },
      ];

      expect(
        buildCollectionOrder({
          now: new Date('2026-08-15T00:00:00.000Z'),
          recentReleaseMonths: 6,
          items,
        }),
      ).toEqual(buildThreeTierOrder({ items }));
    });
  });
});
