import {
  curatedCollectionOrderIndex,
  hasSameCuratedCollectionBase,
  resolveCuratedCollectionBaseName,
  resolveCuratedCollectionPinVisibility,
  sortCollectionNamesByCuratedBaseOrder,
} from './plex-collections.utils';

describe('plex-collections utils', () => {
  it('resolves curated base names while ignoring user suffix', () => {
    expect(
      resolveCuratedCollectionBaseName({
        collectionName: 'Based on your recently watched Movie (Alice)',
        mediaType: 'movie',
      }),
    ).toBe('Based on your recently watched Movie');
    expect(
      resolveCuratedCollectionBaseName({
        collectionName: 'Change of Movie Taste (Bob)',
        mediaType: 'movie',
      }),
    ).toBe('Change of Movie Taste');
    expect(
      resolveCuratedCollectionBaseName({
        collectionName: 'Inspired by your Immaculate Taste in Movies (Carol)',
        mediaType: 'movie',
      }),
    ).toBe('Inspired by your Immaculate Taste in Movies');
    expect(
      resolveCuratedCollectionBaseName({
        collectionName: 'Fresh Out Of The Oven (Dana)',
        mediaType: 'movie',
      }),
    ).toBe('Fresh Out Of The Oven');
    expect(
      resolveCuratedCollectionBaseName({
        collectionName: 'Fresh Out Of The Oven Show (Dana)',
        mediaType: 'tv',
      }),
    ).toBe('Fresh Out Of The Oven Show');
  });

  it('ranks movie and tv curated collection order as recently watched -> change -> immaculate', () => {
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Based on your recently watched Movie (Alice)',
        mediaType: 'movie',
      }),
    ).toBe(0);
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Change of Movie Taste (Alice)',
        mediaType: 'movie',
      }),
    ).toBe(1);
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Inspired by your Immaculate Taste in Movies (Alice)',
        mediaType: 'movie',
      }),
    ).toBe(2);

    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Based on your recently watched Show (Alice)',
        mediaType: 'tv',
      }),
    ).toBe(0);
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Change of Show Taste (Alice)',
        mediaType: 'tv',
      }),
    ).toBe(1);
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Inspired by your Immaculate Taste in Shows (Alice)',
        mediaType: 'tv',
      }),
    ).toBe(2);
  });

  it('sorts by curated base order and matches by base name across users', () => {
    const sorted = sortCollectionNamesByCuratedBaseOrder({
      mediaType: 'movie',
      collectionNames: [
        'Inspired by your Immaculate Taste in Movies (Alice)',
        'Based on your recently watched Movie (Alice)',
        'Change of Movie Taste (Alice)',
      ],
    });
    expect(sorted).toEqual([
      'Based on your recently watched Movie (Alice)',
      'Change of Movie Taste (Alice)',
      'Inspired by your Immaculate Taste in Movies (Alice)',
    ]);

    expect(
      hasSameCuratedCollectionBase({
        left: 'Change of Movie Taste (Alice)',
        right: 'Change of Movie Taste (Bob)',
        mediaType: 'movie',
      }),
    ).toBe(true);
    expect(
      hasSameCuratedCollectionBase({
        left: 'Based on your recently watched Show (Alice)',
        right: 'Based on your recently watched Show (Bob)',
        mediaType: 'tv',
      }),
    ).toBe(true);
  });

  it('keeps caller order for custom/unknown base names', () => {
    const sorted = sortCollectionNamesByCuratedBaseOrder({
      mediaType: 'movie',
      collectionNames: [
        'Based on your recently watched Movie (Alice)',
        'Kids Movie Picks',
        'Anime Night',
        'Change of Movie Taste (Alice)',
      ],
    });
    expect(sorted).toEqual([
      'Based on your recently watched Movie (Alice)',
      'Change of Movie Taste (Alice)',
      'Kids Movie Picks',
      'Anime Night',
    ]);
  });

  describe('resolveCuratedCollectionPinVisibility', () => {
    it('returns home_only for Fresh Out when pinTarget is admin', () => {
      expect(
        resolveCuratedCollectionPinVisibility({
          collectionName: 'Fresh Out Of The Oven (Alice)',
          mediaType: 'movie',
          pinTarget: 'admin',
        }),
      ).toBe('home_only');
    });

    it('returns shared_home_only for Fresh Out when pinTarget is friends', () => {
      expect(
        resolveCuratedCollectionPinVisibility({
          collectionName: 'Fresh Out Of The Oven (Bob)',
          mediaType: 'movie',
          pinTarget: 'friends',
        }),
      ).toBe('shared_home_only');
    });

    it('returns home_only for Fresh Out Show when pinTarget is admin', () => {
      expect(
        resolveCuratedCollectionPinVisibility({
          collectionName: 'Fresh Out Of The Oven Show (Alice)',
          mediaType: 'tv',
          pinTarget: 'admin',
        }),
      ).toBe('home_only');
    });

    it('returns shared_home_only for Fresh Out Show when pinTarget is friends', () => {
      expect(
        resolveCuratedCollectionPinVisibility({
          collectionName: 'Fresh Out Of The Oven Show (Bob)',
          mediaType: 'tv',
          pinTarget: 'friends',
        }),
      ).toBe('shared_home_only');
    });

    it('returns null for non-Fresh-Out curated collections', () => {
      expect(
        resolveCuratedCollectionPinVisibility({
          collectionName: 'Based on your recently watched Movie (Alice)',
          mediaType: 'movie',
          pinTarget: 'admin',
        }),
      ).toBeNull();
      expect(
        resolveCuratedCollectionPinVisibility({
          collectionName: 'Change of Movie Taste (Alice)',
          mediaType: 'movie',
          pinTarget: 'friends',
        }),
      ).toBeNull();
    });

    it('returns null for unknown collection names', () => {
      expect(
        resolveCuratedCollectionPinVisibility({
          collectionName: 'Kids Movie Picks',
          mediaType: 'movie',
          pinTarget: 'admin',
        }),
      ).toBeNull();
    });

    it('returns null for movie Fresh Out base name with tv mediaType', () => {
      expect(
        resolveCuratedCollectionPinVisibility({
          collectionName: 'Fresh Out Of The Oven (Alice)',
          mediaType: 'tv',
          pinTarget: 'admin',
        }),
      ).toBeNull();
    });
  });

  it('places Fresh Out after the default movie rows when explicitly included', () => {
    const sorted = sortCollectionNamesByCuratedBaseOrder({
      mediaType: 'movie',
      collectionNames: [
        'Fresh Out Of The Oven (Alice)',
        'Inspired by your Immaculate Taste in Movies (Alice)',
        'Based on your recently watched Movie (Alice)',
        'Change of Movie Taste (Alice)',
      ],
    });
    expect(sorted).toEqual([
      'Based on your recently watched Movie (Alice)',
      'Change of Movie Taste (Alice)',
      'Inspired by your Immaculate Taste in Movies (Alice)',
      'Fresh Out Of The Oven (Alice)',
    ]);
  });

  it('places Fresh Out Show after the default TV rows when explicitly included', () => {
    const sorted = sortCollectionNamesByCuratedBaseOrder({
      mediaType: 'tv',
      collectionNames: [
        'Fresh Out Of The Oven Show (Alice)',
        'Inspired by your Immaculate Taste in Shows (Alice)',
        'Based on your recently watched Show (Alice)',
        'Change of Show Taste (Alice)',
      ],
    });
    expect(sorted).toEqual([
      'Based on your recently watched Show (Alice)',
      'Change of Show Taste (Alice)',
      'Inspired by your Immaculate Taste in Shows (Alice)',
      'Fresh Out Of The Oven Show (Alice)',
    ]);
  });
});
