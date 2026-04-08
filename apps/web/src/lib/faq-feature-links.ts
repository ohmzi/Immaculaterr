export const FAQ_SECTION_BY_COMMAND_CENTER_CARD_ID = {
  'command-center-recommendations': 'recommendations',
  'command-center-plex-library-selection': 'plex-library-selection',
  'command-center-plex-user-monitoring': 'plex-user-monitoring',
  'command-center-immaculate-taste-profiles': 'immaculate-taste-profiles',
  'command-center-reset-immaculate-taste-collection': 'reset-immaculate-taste-collection',
  'command-center-reset-seerr-requests': 'reset-seerr-requests',
  'command-center-reset-rejected-list': 'reset-rejected-list',
  'command-center-collection-posters': 'collection-posters',
  'command-center-radarr': 'radarr',
  'command-center-sonarr': 'sonarr',
} as const;

export type CommandCenterFeatureCardId = keyof typeof FAQ_SECTION_BY_COMMAND_CENTER_CARD_ID;
export type CommandCenterFaqFeatureSectionId =
  (typeof FAQ_SECTION_BY_COMMAND_CENTER_CARD_ID)[CommandCenterFeatureCardId];

export const COMMAND_CENTER_CARD_ID_BY_FAQ_SECTION = Object.fromEntries(
  Object.entries(FAQ_SECTION_BY_COMMAND_CENTER_CARD_ID).map(([cardId, faqSectionId]) => [
    faqSectionId,
    cardId,
  ]),
) as Record<CommandCenterFaqFeatureSectionId, CommandCenterFeatureCardId>;

export const FAQ_SECTION_BY_TASK_MANAGER_CARD_ID = {
  monitorConfirm: 'task-manager-confirm-monitored',
  unmonitorConfirm: 'task-manager-confirm-unmonitored',
  mediaAddedCleanup: 'task-manager-cleanup-after-adding-new-content',
  arrMonitoredSearch: 'task-manager-search-monitored',
  tmdbUpcomingMovies: 'task-manager-tmdb-upcoming-movies',
  immaculateTastePoints: 'task-manager-immaculate-taste-collection',
  immaculateTasteRefresher: 'task-manager-immaculate-taste-refresher',
  watchedMovieRecommendations: 'task-manager-based-on-latest-watched-collection',
  recentlyWatchedRefresher: 'task-manager-based-on-latest-watched-refresher',
  freshOutOfTheOven: 'task-manager-fresh-out-of-the-oven',
  importNetflixHistory: 'task-manager-import-netflix-history',
  importPlexHistory: 'task-manager-import-plex-history',
} as const;

export type TaskManagerFeatureCardId = keyof typeof FAQ_SECTION_BY_TASK_MANAGER_CARD_ID;
export type TaskManagerFaqFeatureSectionId =
  (typeof FAQ_SECTION_BY_TASK_MANAGER_CARD_ID)[TaskManagerFeatureCardId];

export type FaqFeatureSectionId =
  | CommandCenterFaqFeatureSectionId
  | TaskManagerFaqFeatureSectionId;

export const TASK_MANAGER_CARD_ID_BY_FAQ_SECTION = Object.fromEntries(
  Object.entries(FAQ_SECTION_BY_TASK_MANAGER_CARD_ID).map(([cardId, faqSectionId]) => [
    faqSectionId,
    cardId,
  ]),
) as Record<TaskManagerFaqFeatureSectionId, TaskManagerFeatureCardId>;
