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
        collectionName: 'Based on your recently watched movie (Alice)',
        mediaType: 'movie',
      }),
    ).toBe('Based on your recently watched movie');
    expect(
      resolveCuratedCollectionBaseName({
        collectionName: 'Change of Taste (Bob)',
        mediaType: 'movie',
      }),
    ).toBe('Change of Taste');
    expect(
      resolveCuratedCollectionBaseName({
        collectionName: 'Inspired by your Immaculate Taste (Carol)',
        mediaType: 'movie',
      }),
    ).toBe('Inspired by your Immaculate Taste');
  });

  it('ranks movie and tv curated collection order as recently watched -> change -> immaculate', () => {
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Based on your recently watched movie (Alice)',
        mediaType: 'movie',
      }),
    ).toBe(0);
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Change of Taste (Alice)',
        mediaType: 'movie',
      }),
    ).toBe(1);
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Inspired by your Immaculate Taste (Alice)',
        mediaType: 'movie',
      }),
    ).toBe(2);

    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Based on your recently watched show (Alice)',
        mediaType: 'tv',
      }),
    ).toBe(0);
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Change of Taste (Alice)',
        mediaType: 'tv',
      }),
    ).toBe(1);
    expect(
      curatedCollectionOrderIndex({
        collectionName: 'Inspired by your Immaculate Taste (Alice)',
        mediaType: 'tv',
      }),
    ).toBe(2);
  });

  it('sorts by curated base order and matches by base name across users', () => {
    const sorted = sortCollectionNamesByCuratedBaseOrder({
      mediaType: 'movie',
      collectionNames: [
        'Inspired by your Immaculate Taste (Alice)',
        'Based on your recently watched movie (Alice)',
        'Change of Taste (Alice)',
      ],
    });
    expect(sorted).toEqual([
      'Based on your recently watched movie (Alice)',
      'Change of Taste (Alice)',
      'Inspired by your Immaculate Taste (Alice)',
    ]);

    expect(
      hasSameCuratedCollectionBase({
        left: 'Change of Taste (Alice)',
        right: 'Change of Taste (Bob)',
        mediaType: 'movie',
      }),
    ).toBe(true);
    expect(
      hasSameCuratedCollectionBase({
        left: 'Based on your recently watched show (Alice)',
        right: 'Based on your recently watched show (Bob)',
        mediaType: 'tv',
      }),
    ).toBe(true);
  });
});
