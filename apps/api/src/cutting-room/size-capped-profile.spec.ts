import {
  SIZE_CAPPED_EPISODE_PROFILE,
  SIZE_CAPPED_MOVIE_PROFILE,
  buildSizeBlockFormat,
  buildSizeCappedProfile,
  buildSizePreferenceFormat,
} from './size-capped-profile';

describe('size-capped-profile', () => {
  it('builds a block format with a SizeSpecification over the cap', () => {
    const format = buildSizeBlockFormat('Block >10GB', 10) as {
      name: string;
      specifications: Array<{
        implementation: string;
        fields: Array<{ name: string; value: number }>;
      }>;
    };
    expect(format.name).toBe('Block >10GB');
    expect(format.specifications).toHaveLength(1);
    expect(format.specifications[0].implementation).toBe('SizeSpecification');
    expect(format.specifications[0].fields).toEqual([
      { name: 'min', value: 10 },
      { name: 'max', value: 10000 },
    ]);
  });

  it('builds a preference format spanning the sweet spot', () => {
    const format = buildSizePreferenceFormat('1-2GB', 1, 2) as {
      specifications: Array<{ fields: Array<{ name: string; value: number }> }>;
    };
    expect(format.specifications[0].fields).toEqual([
      { name: 'min', value: 1 },
      { name: 'max', value: 2 },
    ]);
  });

  it('profile constants match the requested caps', () => {
    expect(SIZE_CAPPED_MOVIE_PROFILE.capGb).toBe(10);
    expect(SIZE_CAPPED_EPISODE_PROFILE.capGb).toBe(3);
    expect(SIZE_CAPPED_EPISODE_PROFILE.idealMinGb).toBe(1);
    expect(SIZE_CAPPED_EPISODE_PROFILE.idealMaxGb).toBe(2);
  });

  describe('buildSizeCappedProfile', () => {
    const schema = {
      id: 0,
      name: '',
      upgradeAllowed: false,
      cutoff: 0,
      minFormatScore: 5,
      cutoffFormatScore: 5,
      items: [
        { quality: { id: 0, name: 'Unknown' }, items: [], allowed: false },
        { quality: { id: 24, name: 'WORKPRINT' }, items: [], allowed: false },
        {
          id: 1001,
          name: 'WEB 720p',
          items: [
            { quality: { id: 14, name: 'WEBRip-720p' }, allowed: false },
            { quality: { id: 5, name: 'WEBDL-720p' }, allowed: false },
          ],
          allowed: false,
        },
        {
          id: 1002,
          name: 'WEB 1080p',
          items: [
            { quality: { id: 15, name: 'WEBRip-1080p' }, allowed: false },
            { quality: { id: 3, name: 'WEBDL-1080p' }, allowed: false },
          ],
          allowed: false,
        },
        { quality: { id: 7, name: 'Bluray-1080p' }, items: [], allowed: false },
        { quality: { id: 30, name: 'Remux-1080p' }, items: [], allowed: false },
        { quality: { id: 22, name: 'BR-DISK' }, items: [], allowed: false },
        { quality: { id: 31, name: 'Raw-HD' }, items: [], allowed: false },
      ],
      formatItems: [],
      language: { id: 1, name: 'Any' },
    };
    const formats = [
      { id: 7, name: 'Block >10GB Movie' },
      { id: 3, name: 'Some other format' },
    ];

    const profile = buildSizeCappedProfile({
      name: 'Size Cap',
      schema,
      formats,
      formatScores: new Map([[7, -10000]]),
    }) as Record<string, unknown> & {
      items: Array<{ allowed: boolean; quality?: { name: string } }>;
      formatItems: Array<{ format: number; score: number }>;
    };

    it('allows sensible qualities and blocks disc images and unknowns', () => {
      const byName = new Map(
        profile.items.map((item) => [
          (item as { name?: string }).name ?? item.quality?.name ?? '',
          item.allowed,
        ]),
      );
      expect(byName.get('Unknown')).toBe(false);
      expect(byName.get('BR-DISK')).toBe(false);
      expect(byName.get('Raw-HD')).toBe(false);
      expect(byName.get('WORKPRINT')).toBe(false);
      expect(byName.get('WEB 720p')).toBe(true);
      expect(byName.get('WEB 1080p')).toBe(true);
      expect(byName.get('Bluray-1080p')).toBe(true);
      expect(byName.get('Remux-1080p')).toBe(true);
    });

    it('cuts off at the group containing WEBDL-1080p and enables upgrades', () => {
      expect(profile['cutoff']).toBe(1002);
      expect(profile['upgradeAllowed']).toBe(true);
    });

    it('scores the block format -10000 and everything else 0', () => {
      expect(profile.formatItems).toEqual([
        { format: 7, name: 'Block >10GB Movie', score: -10000 },
        { format: 3, name: 'Some other format', score: 0 },
      ]);
      expect(profile['minFormatScore']).toBe(0);
      expect(profile['cutoffFormatScore']).toBe(0);
    });

    it('names the profile and drops the schema id', () => {
      expect(profile['name']).toBe('Size Cap');
      expect(profile['id']).toBeUndefined();
    });

    it('does not mutate the schema it was given', () => {
      expect(schema.name).toBe('');
      expect(schema.items[3].allowed).toBe(false);
    });
  });
});
