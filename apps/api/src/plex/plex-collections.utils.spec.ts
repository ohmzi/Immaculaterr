import {
  curatedCollectionOrderIndex,
  hasSameCuratedCollectionBase,
  resolveCuratedCollectionBaseName,
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
});
