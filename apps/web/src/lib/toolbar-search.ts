import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listJobs } from '@/api/jobs';

export type ToolbarSearchArea =
  | 'Command Center'
  | 'Task Manager'
  | 'Vault'
  | 'Cutting Room'
  | 'Pages'
  | 'FAQ';

export type ToolbarSearchTarget = {
  id: string;
  title: string;
  area: ToolbarSearchArea;
  route: string;
  hash: string;
  normalizedTitle: string;
};

type ToolbarSearchTargetSeed = Omit<ToolbarSearchTarget, 'normalizedTitle'>;

const TASK_MANAGER_HIDDEN_JOB_IDS = new Set(['collectionResyncUpgrade']);

export function normalizeToolbarSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function createToolbarSearchTarget(target: ToolbarSearchTargetSeed): ToolbarSearchTarget {
  return {
    ...target,
    normalizedTitle: normalizeToolbarSearchText(target.title),
  };
}

export const COMMAND_CENTER_SEARCH_TARGETS: ToolbarSearchTarget[] = [
  createToolbarSearchTarget({
    id: 'command-center-recommendations',
    title: 'Recommendations',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-recommendations',
  }),
  createToolbarSearchTarget({
    id: 'command-center-plex-library-selection',
    title: 'Plex Library Selection',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-plex-library-selection',
  }),
  createToolbarSearchTarget({
    id: 'command-center-plex-user-monitoring',
    title: 'Plex User Monitoring',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-plex-user-monitoring',
  }),
  createToolbarSearchTarget({
    id: 'command-center-immaculate-taste-profiles',
    title: 'Immaculate Taste Profiles',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-immaculate-taste-profiles',
  }),
  createToolbarSearchTarget({
    id: 'command-center-reset-immaculate-taste-collection',
    title: 'Reset Immaculate Taste Collection',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-reset-immaculate-taste-collection',
  }),
  createToolbarSearchTarget({
    id: 'command-center-reset-seerr-requests',
    title: 'Reset Seerr Requests',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-reset-seerr-requests',
  }),
  createToolbarSearchTarget({
    id: 'command-center-reset-rejected-list',
    title: 'Reset Rejected List',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-reset-rejected-list',
  }),
  createToolbarSearchTarget({
    id: 'command-center-collection-posters',
    title: 'Collection Posters',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-collection-posters',
  }),
  createToolbarSearchTarget({
    id: 'command-center-radarr',
    title: 'Radarr',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-radarr',
  }),
  createToolbarSearchTarget({
    id: 'command-center-sonarr',
    title: 'Sonarr',
    area: 'Command Center',
    route: '/command-center',
    hash: 'command-center-sonarr',
  }),
];

export const VAULT_SEARCH_TARGETS: ToolbarSearchTarget[] = [
  createToolbarSearchTarget({
    id: 'vault-plex',
    title: 'Plex Media Server',
    area: 'Vault',
    route: '/vault',
    hash: 'vault-plex',
  }),
  createToolbarSearchTarget({
    id: 'vault-tmdb',
    title: 'The Movie Database (TMDB)',
    area: 'Vault',
    route: '/vault',
    hash: 'vault-tmdb',
  }),
  createToolbarSearchTarget({
    id: 'vault-radarr',
    title: 'Radarr',
    area: 'Vault',
    route: '/vault',
    hash: 'vault-radarr',
  }),
  createToolbarSearchTarget({
    id: 'vault-sonarr',
    title: 'Sonarr',
    area: 'Vault',
    route: '/vault',
    hash: 'vault-sonarr',
  }),
  createToolbarSearchTarget({
    id: 'vault-seerr',
    title: 'Seerr',
    area: 'Vault',
    route: '/vault',
    hash: 'vault-seerr',
  }),
  createToolbarSearchTarget({
    id: 'vault-tautulli',
    title: 'Tautulli',
    area: 'Vault',
    route: '/vault',
    hash: 'vault-tautulli',
  }),
  createToolbarSearchTarget({
    id: 'vault-google',
    title: 'Google Search',
    area: 'Vault',
    route: '/vault',
    hash: 'vault-google',
  }),
  createToolbarSearchTarget({
    id: 'vault-openai',
    title: 'OpenAI',
    area: 'Vault',
    route: '/vault',
    hash: 'vault-openai',
  }),
];

export const CUTTING_ROOM_SEARCH_TARGETS: ToolbarSearchTarget[] = [
  createToolbarSearchTarget({
    id: 'cutting-room-wizard',
    title: 'Cutting Room — Prune Wizard',
    area: 'Cutting Room',
    route: '/cutting-room',
    hash: '',
  }),
  createToolbarSearchTarget({
    id: 'cutting-room-history',
    title: 'Cutting Room — Pruned History',
    area: 'Cutting Room',
    route: '/cutting-room/history',
    hash: '',
  }),
  createToolbarSearchTarget({
    id: 'cutting-room-wanted',
    title: 'Cutting Room — Wanted List',
    area: 'Cutting Room',
    route: '/cutting-room/wanted',
    hash: '',
  }),
  createToolbarSearchTarget({
    id: 'cutting-room-free-space',
    title: 'Free up space',
    area: 'Cutting Room',
    route: '/cutting-room',
    hash: '',
  }),
  createToolbarSearchTarget({
    id: 'cutting-room-large-files',
    title: 'Cutting Room — Large Files',
    area: 'Cutting Room',
    route: '/cutting-room/large-files',
    hash: '',
  }),
  createToolbarSearchTarget({
    id: 'cutting-room-duplicates',
    title: 'Cutting Room — Duplicates',
    area: 'Cutting Room',
    route: '/cutting-room/duplicates',
    hash: '',
  }),
];

export const PAGE_SEARCH_TARGETS: ToolbarSearchTarget[] = [
  ['dashboard', 'Dashboard', '/'],
  ['observatory', 'Observatory', '/observatory'],
  ['cutting-room', 'Cutting Room', '/cutting-room'],
  ['command-center', 'Command Center', '/command-center'],
  ['vault', 'Vault', '/vault'],
  ['task-manager', 'Task Manager', '/task-manager'],
  ['rewind', 'Rewind', '/rewind'],
  ['logs', 'Logs', '/logs'],
  ['profile', 'Profile', '/profile'],
  ['faq', 'FAQ', '/faq'],
  ['setup', 'Setup', '/setup'],
  ['version-history', 'Version History', '/version-history'],
].map(([id, title, route]) =>
  createToolbarSearchTarget({
    id: `page-${id}`,
    title,
    area: 'Pages',
    route,
    hash: '',
  }),
);

const FAQ_SECTION_SEEDS: Array<[string, string]> = [
  ['getting-started', 'Getting started'],
  ['task-manager', 'Task Manager'],
  ['task-manager-confirm-monitored', 'Confirm Monitored'],
  ['task-manager-confirm-unmonitored', 'Confirm Unmonitored'],
  ['task-manager-repair-monitored', 'Repair Monitored'],
  ['task-manager-cleanup-after-adding-new-content', 'Cleanup After Adding New Content'],
  ['task-manager-search-monitored', 'Search Monitored'],
  ['task-manager-tmdb-upcoming-movies', 'TMDB Upcoming Movies'],
  ['task-manager-rotten-tomatoes-upcoming-movies', 'Rotten Tomatoes Upcoming Movies + TV Shows'],
  ['task-manager-immaculate-taste-collection', 'Immaculate Taste Collection'],
  ['task-manager-immaculate-taste-refresher', 'Immaculate Taste Refresher'],
  ['task-manager-based-on-latest-watched-collection', 'Based on Latest Watched Collection'],
  ['task-manager-based-on-latest-watched-refresher', 'Based on Latest Watched Refresher'],
  ['task-manager-fresh-out-of-the-oven', 'Fresh Out Of The Oven'],
  ['task-manager-import-plex-history', 'Plex Watch History Import'],
  ['task-manager-import-netflix-history', 'Netflix Watch History Import'],
  ['recommendations', 'Recommendations'],
  ['plex-library-selection', 'Plex Library Selection'],
  ['plex-user-monitoring', 'Plex User Monitoring'],
  ['immaculate-taste-profiles', 'Immaculate Taste Profiles'],
  ['collection-posters', 'Collection Posters'],
  ['updates', 'Updates & versions'],
  ['security', 'Security & backups'],
  ['troubleshooting', 'Troubleshooting'],
  ['cutting-room', 'Cutting Room'],
  ['glossary', 'Glossary'],
];

export const FAQ_SEARCH_TARGETS: ToolbarSearchTarget[] = FAQ_SECTION_SEEDS.map(
  ([id, title]) =>
    createToolbarSearchTarget({
      id: `faq-${id}`,
      title: `FAQ — ${title}`,
      area: 'FAQ',
      route: '/faq',
      hash: id,
    }),
);

export function getToolbarSearchRank(
  normalizedTitle: string,
  normalizedQuery: string,
): number | null {
  if (!normalizedQuery) return null;
  if (normalizedTitle === normalizedQuery) return 0;
  if (normalizedTitle.startsWith(normalizedQuery)) return 1;
  if (normalizedTitle.includes(` ${normalizedQuery}`)) return 2;
  if (normalizedTitle.includes(normalizedQuery)) return 3;
  return null;
}

export function useToolbarSearchTargets() {
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const taskTargets = useMemo(
    () =>
      (jobsQuery.data?.jobs ?? [])
        .filter(
          (job) =>
            job.visibleInTaskManager && !TASK_MANAGER_HIDDEN_JOB_IDS.has(job.id),
        )
        .map((job) =>
          createToolbarSearchTarget({
            id: `job-${job.id}`,
            title: job.name,
            area: 'Task Manager',
            route: '/task-manager',
            hash: `job-${job.id}`,
          }),
        ),
    [jobsQuery.data?.jobs],
  );

  const targets = useMemo(
    () => [
      ...PAGE_SEARCH_TARGETS,
      ...COMMAND_CENTER_SEARCH_TARGETS,
      ...taskTargets,
      ...VAULT_SEARCH_TARGETS,
      ...CUTTING_ROOM_SEARCH_TARGETS,
      ...FAQ_SEARCH_TARGETS,
    ],
    [taskTargets],
  );

  return {
    targets,
    jobsLoading: jobsQuery.isLoading,
  };
}
