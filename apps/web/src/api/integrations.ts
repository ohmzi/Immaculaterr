import { fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS } from '@/api/constants';

export type TestSavedIntegrationResponse = {
  ok: true;
  // Backend returns different shapes per integration (result/summary/etc).
  [key: string]: unknown;
};

export function testSavedIntegration(
  integrationId: string,
  body?: Record<string, unknown>,
) {
  return fetchJson<TestSavedIntegrationResponse>(
    apiPath(`/integrations/test/${encodeURIComponent(integrationId)}`),
    {
      method: 'POST',
      ...(body
        ? {
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
          }
        : {}),
    },
  );
}

export type RadarrOptionsResponse = {
  ok: true;
  rootFolders: Array<{ id: number; path: string }>;
  qualityProfiles: Array<{ id: number; name: string }>;
  tags: Array<{ id: number; label: string }>;
};

export function getRadarrOptionsForInstance(instanceId?: string) {
  const normalizedInstanceId = instanceId?.trim() ?? '';
  const query = normalizedInstanceId
    ? `?instanceId=${encodeURIComponent(normalizedInstanceId)}`
    : '';
  return fetchJson<RadarrOptionsResponse>(
    apiPath(`/integrations/radarr/options${query}`),
  );
}

export function getRadarrOptions() {
  return getRadarrOptionsForInstance();
}

export type SonarrOptionsResponse = {
  ok: true;
  rootFolders: Array<{ id: number; path: string }>;
  qualityProfiles: Array<{ id: number; name: string }>;
  tags: Array<{ id: number; label: string }>;
};

export function getSonarrOptionsForInstance(instanceId?: string) {
  const normalizedInstanceId = instanceId?.trim() ?? '';
  const query = normalizedInstanceId
    ? `?instanceId=${encodeURIComponent(normalizedInstanceId)}`
    : '';
  return fetchJson<SonarrOptionsResponse>(
    apiPath(`/integrations/sonarr/options${query}`),
  );
}

export function getSonarrOptions() {
  return getSonarrOptionsForInstance();
}

export type PlexLibraryFiltersResponse = {
  ok: true;
  sectionKey: string | null;
  genres: string[];
  audioLanguages: string[];
};

export function getPlexLibraryFilters(sectionKey?: string) {
  const query = sectionKey
    ? `?sectionKey=${encodeURIComponent(sectionKey)}`
    : '';
  return fetchJson<PlexLibraryFiltersResponse>(
    apiPath(`/integrations/plex/library-filters${query}`),
  );
}

export type PlexLibraryItem = {
  key: string;
  title: string;
  type: 'movie' | 'show';
  selected: boolean;
};

export type PlexLibrariesResponse = {
  ok: true;
  libraries: PlexLibraryItem[];
  selectedSectionKeys: string[];
  excludedSectionKeys: string[];
  minimumRequired: number;
  autoIncludeNewLibraries: true;
  cleanup?: {
    deselectedSectionKeys: string[];
    db: {
      immaculateMovieDeleted: number;
      immaculateTvDeleted: number;
      watchedMovieDeleted: number;
      watchedTvDeleted: number;
      totalDeleted: number;
    } | null;
    plex: {
      librariesChecked: number;
      collectionsDeleted: number;
      errors: number;
    } | null;
    error?: string;
  };
};

export type PlexMonitoringUserItem = {
  id: string;
  plexAccountId: number | null;
  plexAccountTitle: string;
  isAdmin: boolean;
  selected: boolean;
};

export type PlexMonitoringUsersResponse = {
  ok: true;
  users: PlexMonitoringUserItem[];
  selectedPlexUserIds: string[];
  excludedPlexUserIds: string[];
  defaultEnabled: true;
  autoIncludeNewUsers: true;
  warning?: string;
};

export function getPlexLibraries() {
  return fetchJson<PlexLibrariesResponse>(apiPath('/integrations/plex/libraries'));
}

export function savePlexLibrarySelection(body: {
  selectedSectionKeys: string[];
  cleanupDeselectedLibraries?: boolean;
}) {
  return fetchJson<PlexLibrariesResponse>(apiPath('/integrations/plex/libraries'), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function getPlexMonitoringUsers() {
  return fetchJson<PlexMonitoringUsersResponse>(
    apiPath('/integrations/plex/monitoring-users'),
  );
}

export function savePlexMonitoringUsers(body: { selectedPlexUserIds: string[] }) {
  return fetchJson<PlexMonitoringUsersResponse>(
    apiPath('/integrations/plex/monitoring-users'),
    {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
}
