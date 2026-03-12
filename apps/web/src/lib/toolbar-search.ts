import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listJobs } from '@/api/jobs';

export type ToolbarSearchArea = 'Command Center' | 'Task Manager' | 'Vault';

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
        .filter((job) => !TASK_MANAGER_HIDDEN_JOB_IDS.has(job.id))
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
    () => [...COMMAND_CENTER_SEARCH_TARGETS, ...taskTargets, ...VAULT_SEARCH_TARGETS],
    [taskTargets],
  );

  return {
    targets,
    jobsLoading: jobsQuery.isLoading,
  };
}
