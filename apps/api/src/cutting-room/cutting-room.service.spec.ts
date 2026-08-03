import {
  type LargeFileListItem,
  dedupeEpisodesByFile,
} from './cutting-room.service';

function episode(overrides: Partial<LargeFileListItem>): LargeFileListItem {
  return {
    kind: 'episode',
    title: 'Episode',
    showTitle: 'Show',
    seasonNumber: 1,
    episodeNumber: 1,
    sizeBytes: 12e9,
    path: '/media/tv/Show/S01E01.mkv',
    arrInstanceId: null,
    movieId: null,
    plexRatingKey: '1',
    ...overrides,
  };
}

describe('dedupeEpisodesByFile', () => {
  it('collapses episodes sharing one file into a single row', () => {
    const double = [
      episode({ title: 'Part 1', episodeNumber: 1 }),
      episode({ title: 'Part 2', episodeNumber: 2, plexRatingKey: '2' }),
    ];
    const out = dedupeEpisodesByFile(double);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Part 1 (+1 more in this file)');
    expect(out[0].sizeBytes).toBe(12e9);
  });

  it('keeps distinct files, movies, and path-less items untouched', () => {
    const items: LargeFileListItem[] = [
      episode({ path: '/media/tv/Show/S01E01.mkv' }),
      episode({ path: '/media/tv/Show/S01E02.mkv', episodeNumber: 2 }),
      episode({ path: null }),
      {
        kind: 'movie',
        title: 'Big Movie',
        showTitle: null,
        seasonNumber: null,
        episodeNumber: null,
        sizeBytes: 20e9,
        path: '/data/movies/Big Movie/Big.Movie.mkv',
        arrInstanceId: 'radarr-1',
        movieId: 42,
        plexRatingKey: null,
      },
    ];
    const out = dedupeEpisodesByFile(items);
    expect(out).toHaveLength(4);
    expect(out.map((i) => i.title)).toContain('Big Movie');
  });
});
