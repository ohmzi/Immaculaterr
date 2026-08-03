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
  repairMonitored: 'task-manager-repair-monitored',
  mediaAddedCleanup: 'task-manager-cleanup-after-adding-new-content',
  arrMonitoredSearch: 'task-manager-search-monitored',
  tmdbUpcomingMovies: 'task-manager-tmdb-upcoming-movies',
  rottenTomatoesUpcomingMovies: 'task-manager-rotten-tomatoes-upcoming-movies',
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

// Feature areas that live on their own page instead of a Command Center or
// Task Manager card. The FAQ shortcut targets the page itself.
export const FEATURE_PAGE_PATH_BY_FAQ_SECTION = {
  'cutting-room': '/cutting-room',
} as const;

export type FeaturePageFaqSectionId = keyof typeof FEATURE_PAGE_PATH_BY_FAQ_SECTION;

export type FaqFeatureSectionId =
  | CommandCenterFaqFeatureSectionId
  | TaskManagerFaqFeatureSectionId
  | FeaturePageFaqSectionId;

export const TASK_MANAGER_CARD_ID_BY_FAQ_SECTION = Object.fromEntries(
  Object.entries(FAQ_SECTION_BY_TASK_MANAGER_CARD_ID).map(([cardId, faqSectionId]) => [
    faqSectionId,
    cardId,
  ]),
) as Record<TaskManagerFaqFeatureSectionId, TaskManagerFeatureCardId>;

// Cutting Room keeps its whole FAQ in one section, so the in-app FAQ buttons
// deep-link to a single question each. Every one of those questions gets its
// own shortcut back to the tab that hosts the button.
export const CUTTING_ROOM_LABEL_BY_PATH = {
  '/cutting-room': 'Cutting Room',
  '/cutting-room/history': 'Pruned History',
  '/cutting-room/wanted': 'Wanted List',
  '/cutting-room/duplicates': 'Duplicates',
  '/cutting-room/large-files': 'Large Files',
} as const;

export type CuttingRoomPath = keyof typeof CUTTING_ROOM_LABEL_BY_PATH;

export const isCuttingRoomPath = (path: string): path is CuttingRoomPath =>
  path in CUTTING_ROOM_LABEL_BY_PATH;

export const CUTTING_ROOM_PATH_BY_FAQ_ITEM = {
  'cutting-room-overview': '/cutting-room',
  'cutting-room-factor-core': '/cutting-room',
  'cutting-room-tiers': '/cutting-room',
  'cutting-room-prune-safety': '/cutting-room',
  'cutting-room-pruned-tag-restore': '/cutting-room/history',
  'cutting-room-wanted-list': '/cutting-room/wanted',
  'cutting-room-duplicates': '/cutting-room/duplicates',
  // Also reachable from the wizard's oversized-files mode — the return path is
  // narrowed to wherever the reader actually came from when that is known.
  'cutting-room-large-files': '/cutting-room/large-files',
} as const satisfies Record<string, CuttingRoomPath>;

export type CuttingRoomFaqItemId = keyof typeof CUTTING_ROOM_PATH_BY_FAQ_ITEM;

// Router state an in-app FAQ button attaches so the FAQ can point its shortcut
// back at the exact tab the reader left.
export type FaqReturnState = {
  featureReturnTo?: string;
  featureReturnAnchor?: string;
};
