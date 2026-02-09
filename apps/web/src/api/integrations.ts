import { fetchJson } from '@/api/http';

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
    `/api/integrations/test/${encodeURIComponent(integrationId)}`,
    {
      method: 'POST',
      ...(body
        ? {
            headers: { 'Content-Type': 'application/json' },
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

export function getRadarrOptions() {
  return fetchJson<RadarrOptionsResponse>('/api/integrations/radarr/options');
}

export type SonarrOptionsResponse = {
  ok: true;
  rootFolders: Array<{ id: number; path: string }>;
  qualityProfiles: Array<{ id: number; name: string }>;
  tags: Array<{ id: number; label: string }>;
};

export function getSonarrOptions() {
  return fetchJson<SonarrOptionsResponse>('/api/integrations/sonarr/options');
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
};

export function getPlexLibraries() {
  return fetchJson<PlexLibrariesResponse>('/api/integrations/plex/libraries');
}

export function savePlexLibrarySelection(body: { selectedSectionKeys: string[] }) {
  return fetchJson<PlexLibrariesResponse>('/api/integrations/plex/libraries', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
