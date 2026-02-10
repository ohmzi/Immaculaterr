export type JobDefinitionInfo = {
  id: string;
  name: string;
  description: string;
  defaultScheduleCron?: string;
};

export const JOB_DEFINITIONS: JobDefinitionInfo[] = [
  {
    id: 'monitorConfirm',
    name: 'Confirm Monitored',
    description:
      'Unmonitor items already present in Plex and optionally trigger Sonarr MissingEpisodeSearch.',
    defaultScheduleCron: '0 1 * * *', // 1am daily (disabled by default)
  },
  {
    id: 'mediaAddedCleanup',
    name: 'Cleanup After Adding New Content',
    description:
      'Auto-run: triggered by Plex webhooks when new media is added (duplicate cleanup across all libraries + unmonitor + watchlist removal when complete). Run Now: full sweep across all libraries + watchlist reconciliation.',
    defaultScheduleCron: undefined,
  },
  {
    id: 'arrMonitoredSearch',
    name: 'Search Monitored',
    description:
      'Scheduled missing-search for monitored items: Radarr MissingMoviesSearch, then Sonarr MissingEpisodeSearch (Sonarr starts 1 hour later when both are enabled).',
    defaultScheduleCron: '0 4 * * 0', // Sunday at 4am weekly (disabled by default)
  },
  {
    id: 'immaculateTastePoints',
    name: 'Immaculate Taste Collection',
    description:
      'Triggered by Plex webhooks when a movie is finished. Updates the Immaculate Taste points dataset and optionally sends missing movies to Radarr.',
    defaultScheduleCron: undefined,
  },
  {
    id: 'immaculateTasteRefresher',
    name: 'Immaculate Taste Refresher',
    description:
      'Off-peak refresh of the "Inspired by your Immaculate Taste" Plex collection across all users and their Plex movie and TV libraries.',
    defaultScheduleCron: '0 3 * * *', // 3am daily (disabled by default)
  },
  {
    id: 'watchedMovieRecommendations',
    name: 'Based on Latest Watched Collection',
    description:
      'Triggered by Plex webhooks when a movie is finished. Generates recommendations and rebuilds curated Plex collections in the same Plex movie library you watched from.',
    defaultScheduleCron: undefined,
  },
  {
    id: 'recentlyWatchedRefresher',
    name: 'Based on Latest Watched Refresher',
    description:
      'Refreshes and reshuffles curated Plex collections for all users across their movie and TV libraries.',
    defaultScheduleCron: '0 2 * * *', // 2am daily (disabled by default)
  },
];

export function findJobDefinition(
  jobId: string,
): JobDefinitionInfo | undefined {
  return JOB_DEFINITIONS.find((j) => j.id === jobId);
}
