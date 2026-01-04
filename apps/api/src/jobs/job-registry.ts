export type JobDefinitionInfo = {
  id: string;
  name: string;
  description: string;
  defaultScheduleCron?: string;
};

export const JOB_DEFINITIONS: JobDefinitionInfo[] = [
  {
    id: 'monitorConfirm',
    name: 'Monitor Confirm',
    description:
      'Unmonitor items already present in Plex and optionally trigger Sonarr MissingEpisodeSearch.',
    defaultScheduleCron: '0 3 * * *', // 3am daily (placeholder)
  },
  {
    id: 'watchedMovieRecommendations',
    name: 'Watched Movie Recommendations',
    description:
      'Triggered by Plex webhooks when a movie is finished. Generates recommendations and rebuilds curated Plex collections.',
    defaultScheduleCron: undefined,
  },
  {
    id: 'recentlyWatchedRefresher',
    name: 'Collection Refresher',
    description:
      'Refresh Plex collections for recently watched recommendations.',
    defaultScheduleCron: '0 1 * * *', // 1am daily (placeholder)
  },
  {
    id: 'noop',
    name: 'No-op (diagnostic)',
    description:
      'A tiny job to validate the job runner, logging, and schedules.',
    defaultScheduleCron: undefined,
  },
];

export function findJobDefinition(
  jobId: string,
): JobDefinitionInfo | undefined {
  return JOB_DEFINITIONS.find((j) => j.id === jobId);
}
