import {
  buildExcludedLibrariesFromSelected,
  buildExcludedSectionKeysFromSelected,
  isPlexLibrarySectionExcluded,
  readConfiguredExcludedSectionKeys,
  resolvePlexLibrarySelection,
  sanitizeSectionKeys,
  toEligiblePlexLibraries,
} from './plex-library-selection.utils';

describe('plex-library-selection.utils', () => {
  describe('sanitizeSectionKeys', () => {
    it('trims and de-duplicates values', () => {
      expect(sanitizeSectionKeys([' 1 ', '2', '1', 3, null])).toEqual([
        '1',
        '2',
        '3',
      ]);
    });
  });

  describe('toEligiblePlexLibraries', () => {
    it('returns movie/show sections only', () => {
      const out = toEligiblePlexLibraries([
        { key: '3', title: 'Photos', type: 'photo' },
        { key: '1', title: 'Movies', type: 'movie' },
        { key: '2', title: 'Shows', type: 'show' },
      ]);
      expect(out).toEqual([
        { key: '1', title: 'Movies', type: 'movie' },
        { key: '2', title: 'Shows', type: 'show' },
      ]);
    });
  });

  describe('resolvePlexLibrarySelection', () => {
    const sections = [
      { key: '1', title: 'Movies', type: 'movie' },
      { key: '2', title: 'Shows', type: 'show' },
      { key: '3', title: '4K Movies', type: 'movie' },
    ];

    it('defaults to all selected when config is missing', () => {
      const selection = resolvePlexLibrarySelection({
        settings: {},
        sections,
      });
      expect(selection.selectedSectionKeys).toEqual(['3', '1', '2']);
      expect(selection.excludedSectionKeys).toEqual([]);
    });

    it('applies configured exclusions limited to eligible libraries', () => {
      const selection = resolvePlexLibrarySelection({
        settings: {
          plex: {
            librarySelection: {
              excludedSectionKeys: ['2', 'missing'],
            },
          },
        },
        sections,
      });
      expect(selection.excludedSectionKeys).toEqual(['2']);
      expect(selection.selectedSectionKeys).toEqual(['3', '1']);
    });
  });

  describe('buildExcludedSectionKeysFromSelected', () => {
    it('computes complement of selected keys', () => {
      const excluded = buildExcludedSectionKeysFromSelected({
        eligibleLibraries: [{ key: '1' }, { key: '2' }, { key: '3' }],
        selectedSectionKeys: ['1', '3'],
      });
      expect(excluded).toEqual(['2']);
    });
  });

  describe('readConfiguredExcludedSectionKeys', () => {
    it('reads configured key list and sanitizes it', () => {
      expect(
        readConfiguredExcludedSectionKeys({
          plex: {
            librarySelection: {
              excludedSectionKeys: [' 4 ', '4', 9],
            },
          },
        }),
      ).toEqual(['4', '9']);
    });
  });

  describe('isPlexLibrarySectionExcluded', () => {
    it('returns true only for configured excluded keys', () => {
      const settings = {
        plex: {
          librarySelection: {
            excludedSectionKeys: ['10'],
          },
        },
      };
      expect(isPlexLibrarySectionExcluded({ settings, sectionKey: '10' })).toBe(
        true,
      );
      expect(isPlexLibrarySectionExcluded({ settings, sectionKey: 10 })).toBe(
        true,
      );
      expect(isPlexLibrarySectionExcluded({ settings, sectionKey: '11' })).toBe(
        false,
      );
    });
  });
});

describe('re-keyed library exclusions', () => {
  const sections = [
    { key: '1', title: 'Movies', type: 'movie' },
    { key: '3', title: 'TV Shows', type: 'show' },
    { key: '8', title: 'Side Quest', type: 'movie' },
  ];

  it('follows an exclusion to the new key when the library was re-created', () => {
    const selection = resolvePlexLibrarySelection({
      settings: {
        plex: {
          librarySelection: {
            excludedSectionKeys: ['7'],
            excludedLibraries: [
              { key: '7', title: 'Side Quest', type: 'movie' },
            ],
          },
        },
      },
      sections,
    });
    expect(selection.excludedSectionKeys).toEqual(['8']);
    expect(selection.selectedSectionKeys).toEqual(['1', '3']);
  });

  it('does not match across types or unrelated titles', () => {
    const selection = resolvePlexLibrarySelection({
      settings: {
        plex: {
          librarySelection: {
            excludedLibraries: [
              { key: '7', title: 'Side Quest', type: 'show' },
              { key: '9', title: 'Anime', type: 'movie' },
            ],
          },
        },
      },
      sections,
    });
    expect(selection.excludedSectionKeys).toEqual([]);
    expect(selection.selectedSectionKeys).toEqual(['1', '8', '3']);
  });

  it('legacy key-only exclusions still apply when the key exists', () => {
    const selection = resolvePlexLibrarySelection({
      settings: {
        plex: { librarySelection: { excludedSectionKeys: ['8'] } },
      },
      sections,
    });
    expect(selection.excludedSectionKeys).toEqual(['8']);
  });

  it('builds title-aware triples from a selection', () => {
    const triples = buildExcludedLibrariesFromSelected({
      eligibleLibraries: [
        { key: '1', title: 'Movies', type: 'movie' },
        { key: '8', title: 'Side Quest', type: 'movie' },
      ],
      selectedSectionKeys: ['1'],
    });
    expect(triples).toEqual([{ key: '8', title: 'Side Quest', type: 'movie' }]);
  });
});
