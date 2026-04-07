import type { JobRunTrigger, JsonObject } from './jobs.types';

export const IMMACULATE_TASTE_PROFILE_ACTION_JOB_ID =
  'immaculateTasteProfileAction';

export type JobDedupePolicy =
  | 'none'
  | 'schedule_singleton'
  | 'queue_fingerprint'
  | 'profile_action_target';

export type JobEstimateKeyBuilderParams = {
  jobId: string;
  dryRun: boolean;
  trigger?: JobRunTrigger;
  userId?: string | null;
  input?: JsonObject | null;
  summary?: JsonObject | null;
};

export type JobExecutionMode = 'handler' | 'external';

export type JobDefinitionInfo = {
  id: string;
  name: string;
  description: string;
  defaultScheduleCron?: string;
  internalOnly?: boolean;
  visibleInTaskManager: boolean;
  visibleInRewind: boolean;
  rewindDisplayName: string;
  defaultEstimatedRuntimeMs: number;
  dedupePolicy: JobDedupePolicy;
  executionMode: JobExecutionMode;
  estimateKeyBuilder: (params: JobEstimateKeyBuilderParams) => string;
  queueFingerprintBuilder?: (
    params: JobEstimateKeyBuilderParams,
  ) => string | null;
};

function buildDefaultEstimateKey(params: JobEstimateKeyBuilderParams): string {
  return `${params.jobId}|dryRun:${params.dryRun ? '1' : '0'}`;
}

function pickString(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!value) return '';
  const raw = value[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function pickNestedString(
  value: Record<string, unknown> | null | undefined,
  path: string[],
): string {
  let current: unknown = value;
  for (const part of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return '';
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current.trim() : '';
}

function buildProfileActionEstimateKey(
  params: JobEstimateKeyBuilderParams,
): string {
  const input = params.input ?? null;
  const summary = params.summary ?? null;
  const raw =
    summary &&
    typeof summary === 'object' &&
    !Array.isArray(summary) &&
    summary['template'] === 'jobReportV1' &&
    summary['raw'] &&
    typeof summary['raw'] === 'object' &&
    !Array.isArray(summary['raw'])
      ? (summary['raw'] as Record<string, unknown>)
      : null;

  const action =
    pickString(input, 'action') ||
    pickString(raw, 'action') ||
    pickNestedString(summary, ['raw', 'action']) ||
    'unknown';
  const profileId =
    pickString(input, 'profileId') || pickString(raw, 'profileId');
  const scopePlexUserId =
    pickString(input, 'scopePlexUserId') || pickString(raw, 'scopePlexUserId');

  return [
    buildDefaultEstimateKey(params),
    `action:${action}`,
    profileId ? `profile:${profileId}` : null,
    scopePlexUserId ? `plexUser:${scopePlexUserId}` : null,
  ]
    .filter(Boolean)
    .join('|');
}

function buildCollectionEstimateKey(
  params: JobEstimateKeyBuilderParams,
): string {
  const input = params.input ?? null;
  const mediaType = pickString(input, 'mediaType') || 'unknown';
  return `${buildDefaultEstimateKey(params)}|mediaType:${mediaType}`;
}

function buildWebhookFingerprint(
  params: JobEstimateKeyBuilderParams,
): string | null {
  const input = params.input ?? null;
  if (!input) return null;

  const sessionAutomationId = pickString(input, 'sessionAutomationId');
  if (sessionAutomationId) {
    return `${params.jobId}|session:${sessionAutomationId}|dryRun:${params.dryRun ? '1' : '0'}`;
  }

  const mediaType =
    pickString(input, 'mediaType') || pickString(input, 'type') || 'unknown';
  const plexUserId = pickString(input, 'plexUserId');
  const seedRatingKey =
    pickString(input, 'seedRatingKey') ||
    pickString(input, 'ratingKey') ||
    pickString(input, 'showRatingKey');
  const seedTitle =
    pickString(input, 'seedTitle') ||
    pickString(input, 'title') ||
    pickString(input, 'showTitle');
  const persistedPath = pickString(input, 'persistedPath');
  const seasonNumber = pickString(input, 'seasonNumber');
  const episodeNumber = pickString(input, 'episodeNumber');

  const parts = [
    params.jobId,
    `dryRun:${params.dryRun ? '1' : '0'}`,
    mediaType ? `media:${mediaType}` : null,
    plexUserId ? `plexUser:${plexUserId}` : null,
    seedRatingKey ? `ratingKey:${seedRatingKey}` : null,
    seedTitle ? `title:${seedTitle.toLowerCase()}` : null,
    persistedPath ? `path:${persistedPath}` : null,
    seasonNumber ? `season:${seasonNumber}` : null,
    episodeNumber ? `episode:${episodeNumber}` : null,
  ];

  const fingerprint = parts.filter(Boolean).join('|');
  return fingerprint || null;
}

function buildProfileActionFingerprint(
  params: JobEstimateKeyBuilderParams,
): string | null {
  const input = params.input ?? null;
  const action = pickString(input, 'action');
  const profileId = pickString(input, 'profileId');
  const profileName = pickString(input, 'profileName');
  const scopePlexUserId = pickString(input, 'scopePlexUserId');

  const parts = [
    params.jobId,
    params.userId ? `user:${params.userId}` : null,
    action ? `action:${action}` : null,
    profileId ? `profile:${profileId}` : null,
    profileName ? `name:${profileName.toLowerCase()}` : null,
    scopePlexUserId ? `plexUser:${scopePlexUserId}` : null,
  ];
  const fingerprint = parts.filter(Boolean).join('|');
  return fingerprint || null;
}

function defineJob(
  job: Omit<
    JobDefinitionInfo,
    | 'executionMode'
    | 'internalOnly'
    | 'visibleInTaskManager'
    | 'visibleInRewind'
    | 'rewindDisplayName'
  > &
    Partial<
      Pick<
        JobDefinitionInfo,
        | 'executionMode'
        | 'internalOnly'
        | 'visibleInTaskManager'
        | 'visibleInRewind'
        | 'rewindDisplayName'
      >
    >,
): JobDefinitionInfo {
  return {
    internalOnly: false,
    visibleInTaskManager: true,
    visibleInRewind: true,
    rewindDisplayName: job.rewindDisplayName ?? job.name,
    executionMode: 'handler',
    ...job,
  };
}

export const JOB_DEFINITIONS: JobDefinitionInfo[] = [
  defineJob({
    id: 'collectionResyncUpgrade',
    name: 'One-Time Collection Resync Upgrade',
    description:
      'Startup migration: refresh Plex user titles, delete Immaculaterr-managed curated collections, and recreate managed collections sequentially with crash-safe checkpoints.',
    defaultScheduleCron: undefined,
    defaultEstimatedRuntimeMs: 20 * 60_000,
    dedupePolicy: 'queue_fingerprint',
    estimateKeyBuilder: buildDefaultEstimateKey,
    queueFingerprintBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: 'monitorConfirm',
    name: 'Confirm Monitored',
    description:
      'Unmonitor items already present in Plex and optionally trigger Sonarr MissingEpisodeSearch.',
    defaultScheduleCron: '0 1 * * *',
    defaultEstimatedRuntimeMs: 12 * 60_000,
    dedupePolicy: 'schedule_singleton',
    estimateKeyBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: 'unmonitorConfirm',
    name: 'Confirm Unmonitored',
    description:
      'Checks Radarr unmonitored movies against Plex movie libraries and re-monitors anything that is not actually present in Plex.',
    defaultScheduleCron: undefined,
    defaultEstimatedRuntimeMs: 20 * 60_000,
    dedupePolicy: 'none',
    estimateKeyBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: 'mediaAddedCleanup',
    name: 'Cleanup After Adding New Content',
    description:
      'Auto-run: triggered by Plex webhooks when new media is added. Run Now: full sweep across all libraries. Cleanup actions (duplicate cleanup, ARR unmonitoring, and watchlist removal) are configurable in Task Manager.',
    defaultScheduleCron: undefined,
    defaultEstimatedRuntimeMs: 8 * 60_000,
    dedupePolicy: 'queue_fingerprint',
    estimateKeyBuilder: buildCollectionEstimateKey,
    queueFingerprintBuilder: buildWebhookFingerprint,
  }),
  defineJob({
    id: 'arrMonitoredSearch',
    name: 'Search Monitored',
    description:
      'Scheduled missing-search for monitored items: Radarr MissingMoviesSearch, then Sonarr MissingEpisodeSearch (Sonarr starts 1 hour later when both are enabled).',
    defaultScheduleCron: '0 4 * * 0',
    defaultEstimatedRuntimeMs: 18 * 60_000,
    dedupePolicy: 'schedule_singleton',
    estimateKeyBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: 'tmdbUpcomingMovies',
    name: 'TMDB Upcoming Movies',
    description:
      'Discovers upcoming movies from TMDB filter sets, merges and ranks candidates, and routes the top results to Radarr or Seerr.',
    defaultScheduleCron: '0 5 * * 0',
    defaultEstimatedRuntimeMs: 14 * 60_000,
    dedupePolicy: 'schedule_singleton',
    estimateKeyBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: 'immaculateTastePoints',
    name: 'Immaculate Taste Collection',
    description:
      'Triggered by Plex webhooks when a movie is finished. Updates the Immaculate Taste points dataset and optionally sends missing movies to Radarr.',
    defaultScheduleCron: undefined,
    defaultEstimatedRuntimeMs: 12 * 60_000,
    dedupePolicy: 'queue_fingerprint',
    estimateKeyBuilder: buildCollectionEstimateKey,
    queueFingerprintBuilder: buildWebhookFingerprint,
  }),
  defineJob({
    id: 'immaculateTasteRefresher',
    name: 'Immaculate Taste Refresher',
    description:
      'Off-peak refresh of the "Inspired by your Immaculate Taste" Plex collection across all users and their Plex movie and TV libraries.',
    defaultScheduleCron: '0 3 * * *',
    defaultEstimatedRuntimeMs: 18 * 60_000,
    dedupePolicy: 'schedule_singleton',
    estimateKeyBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: 'watchedMovieRecommendations',
    name: 'Based on Latest Watched Collection',
    description:
      'Triggered by Plex webhooks when a movie is finished. Generates recommendations and rebuilds curated Plex collections in the same Plex movie library you watched from.',
    defaultScheduleCron: undefined,
    defaultEstimatedRuntimeMs: 12 * 60_000,
    dedupePolicy: 'queue_fingerprint',
    estimateKeyBuilder: buildCollectionEstimateKey,
    queueFingerprintBuilder: buildWebhookFingerprint,
  }),
  defineJob({
    id: 'recentlyWatchedRefresher',
    name: 'Based on Latest Watched Refresher',
    description:
      'Refreshes and reshuffles curated Plex collections for all users across their movie and TV libraries.',
    defaultScheduleCron: '0 2 * * *',
    defaultEstimatedRuntimeMs: 18 * 60_000,
    dedupePolicy: 'schedule_singleton',
    estimateKeyBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: 'freshOutOfTheOven',
    name: 'Fresh Out Of The Oven',
    description:
      'Builds a recent-release movie baseline for the last 3 months and refreshes per-user unseen Plex collections across shared and admin homes.',
    defaultScheduleCron: '30 2 * * *',
    defaultEstimatedRuntimeMs: 18 * 60_000,
    dedupePolicy: 'schedule_singleton',
    estimateKeyBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: 'importNetflixHistory',
    name: 'Netflix Watch History Import',
    description:
      'Classifies uploaded Netflix titles via TMDB, generates recommendations, and creates consolidated Plex collections.',
    defaultScheduleCron: undefined,
    defaultEstimatedRuntimeMs: 12 * 60_000,
    dedupePolicy: 'none',
    estimateKeyBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: 'importPlexHistory',
    name: 'Plex Watch History Import',
    description:
      'Analyzes your Plex watch history, generates recommendations, and creates consolidated Plex collections.',
    defaultScheduleCron: undefined,
    defaultEstimatedRuntimeMs: 12 * 60_000,
    dedupePolicy: 'none',
    estimateKeyBuilder: buildDefaultEstimateKey,
  }),
  defineJob({
    id: IMMACULATE_TASTE_PROFILE_ACTION_JOB_ID,
    name: 'Immaculate Taste Profile Action',
    description:
      'Internal profile maintenance action recorded in Rewind for auditability.',
    defaultScheduleCron: undefined,
    internalOnly: true,
    visibleInTaskManager: false,
    visibleInRewind: true,
    rewindDisplayName: 'Profile action',
    defaultEstimatedRuntimeMs: 2 * 60_000,
    dedupePolicy: 'profile_action_target',
    executionMode: 'external',
    estimateKeyBuilder: buildProfileActionEstimateKey,
    queueFingerprintBuilder: buildProfileActionFingerprint,
  }),
];

export function findJobDefinition(
  jobId: string,
): JobDefinitionInfo | undefined {
  return JOB_DEFINITIONS.find((job) => job.id === jobId);
}

export function buildJobEstimateKey(
  params: JobEstimateKeyBuilderParams,
): string {
  return (
    findJobDefinition(params.jobId)?.estimateKeyBuilder(params) ??
    buildDefaultEstimateKey(params)
  );
}

export function buildJobQueueFingerprint(
  params: JobEstimateKeyBuilderParams,
): string | null {
  const definition = findJobDefinition(params.jobId);
  if (!definition?.queueFingerprintBuilder) return null;
  return definition.queueFingerprintBuilder(params);
}
