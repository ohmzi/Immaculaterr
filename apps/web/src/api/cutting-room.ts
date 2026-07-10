import { fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS, toQuerySuffix } from '@/api/constants';
import type { JobRun } from '@/api/jobs';

export type CuttingRoomFactorToggles = {
  lowRating: boolean;
  provenanceTags: boolean;
  unmonitored: boolean;
  endedShow: boolean;
  abandoned: boolean;
  largeFiles: boolean;
  watchedLongAgo: boolean;
};

export type CuttingRoomRules = {
  requireTautulli: boolean;
  recencyWindowDays: number;
  graceDays: number;
  protectedTagLabels: string[];
  protectedSectionKeys: string[];
  protectedPlexUserIds: string[];
  protectWatchlist: boolean;
  protectOnDeck: boolean;
  protectSeerrRequests: boolean;
  seerrRequestWindowDays: number;
  protectManagedCollections: boolean;
  allowPlexOnlyDeletes: boolean;
  pruneTagLabel: string;
  largeFilesThresholdGb: number;
  maxItemsPerRun: number;
  maxBytesPerRun: number;
  abandonedMaxFraction: number;
  abandonedStaleDays: number;
  watchedLongAgoDays: number;
  tier1MinAgeDays: number;
  tier1MinScore: number;
  tier2MinAgeDays: number;
  factors: CuttingRoomFactorToggles;
};

export type CuttingRoomPrereqs = {
  plexConfigured: boolean;
  tautulli: { configured: boolean; required: boolean };
};

export type CuttingRoomSnapshot = {
  id: string;
  kind: string;
  mediaType: 'movie' | 'show';
  status: string;
  rules: CuttingRoomRules | null;
  scope: { sections?: string[]; instances?: string[] } | null;
  analyzeRunId: string | null;
  pruneRunId: string | null;
  stopRequested: boolean;
  targetBytes: number | null;
  libraryCount: number;
  libraryBytes: number;
  candidateCount: number;
  candidateBytes: number;
  selectedCount: number;
  selectedBytes: number;
  protectedCounts: Record<string, number>;
  tiers: Record<string, { count: number; bytes: number }>;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type CuttingRoomReason = { code: string; label: string; points: number };

export type CuttingRoomCandidate = {
  id: string;
  mediaType: string;
  title: string;
  year: number | null;
  tier: number;
  score: number;
  sizeBytes: number;
  fileCount: number;
  watchStatus: string;
  confidence: string;
  plexRatingKey: string | null;
  librarySectionKey: string | null;
  tmdbId: number | null;
  tvdbId: number | null;
  arrInstanceId: string | null;
  arrId: number | null;
  monitored: boolean | null;
  rootFolderPath: string | null;
  path: string | null;
  addedAt: string | null;
  lastWatchedAt: string | null;
  rating: number | null;
  reasons: CuttingRoomReason[];
  selected: boolean;
  pruneStatus: string;
  pruneError: string | null;
};

export type CuttingRoomDisk = {
  instanceId: string;
  path: string;
  label: string | null;
  freeSpace: number;
  totalSpace: number;
};

export type PruneHistoryItem = {
  id: string;
  source: string;
  mediaType: string;
  title: string;
  year: number | null;
  sizeBytes: number;
  tmdbId: number | null;
  tvdbId: number | null;
  arrInstanceId: string | null;
  arrId: number | null;
  action: string;
  tagApplied: boolean;
  restoredAt: string | null;
  restoreNote: string | null;
  createdAt: string;
};

export type WantedItem = {
  arrId: number;
  title: string;
  year: number | null;
  added: string | null;
  tmdbId: number | null;
  tvdbId: number | null;
};

export function getCuttingRoomRules() {
  return fetchJson<{ rules: CuttingRoomRules; prereqs: CuttingRoomPrereqs }>(
    apiPath('/cutting-room/rules'),
  );
}

export function putCuttingRoomRules(rules: Partial<CuttingRoomRules>) {
  return fetchJson<{ rules: CuttingRoomRules }>(apiPath('/cutting-room/rules'), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ rules }),
  });
}

export function listCuttingRoomLibraries(mediaType: 'movie' | 'show') {
  return fetchJson<{ libraries: Array<{ key: string; title: string }> }>(
    apiPath(`/cutting-room/libraries?mediaType=${mediaType}`),
  );
}

export function getCuttingRoomDiskspace(type: 'radarr' | 'sonarr') {
  return fetchJson<{
    disks: CuttingRoomDisk[];
    recycleBin: { configured: boolean | null; path?: string | null };
  }>(apiPath(`/cutting-room/diskspace?type=${type}`));
}

export function startCuttingRoomAnalyze(body: {
  mediaType: 'movie' | 'show';
  sectionKeys: string[];
  instanceIds?: string[];
}) {
  return fetchJson<{ snapshotId: string; run: JobRun }>(
    apiPath('/cutting-room/analyze'),
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
}

export function getCuttingRoomSnapshot(snapshotId: string) {
  return fetchJson<{ snapshot: CuttingRoomSnapshot }>(
    apiPath(`/cutting-room/snapshots/${encodeURIComponent(snapshotId)}`),
  );
}

export function listCuttingRoomSnapshots(take = 10) {
  return fetchJson<{ snapshots: CuttingRoomSnapshot[] }>(
    apiPath(`/cutting-room/snapshots?take=${take}`),
  );
}

export function listCuttingRoomCandidates(params: {
  snapshotId: string;
  take?: number;
  skip?: number;
  sort?: 'score' | 'size' | 'scorePerGb' | 'addedAt';
  dir?: 'asc' | 'desc';
  maxTier?: number;
  minScore?: number;
  rootFolder?: string;
  watchStatus?: string;
  search?: string;
  selectedOnly?: boolean;
}) {
  const q = new URLSearchParams();
  if (params.take) q.set('take', String(params.take));
  if (params.skip) q.set('skip', String(params.skip));
  if (params.sort) q.set('sort', params.sort);
  if (params.dir) q.set('dir', params.dir);
  if (params.maxTier) q.set('maxTier', String(params.maxTier));
  if (params.minScore) q.set('minScore', String(params.minScore));
  if (params.rootFolder) q.set('rootFolder', params.rootFolder);
  if (params.watchStatus) q.set('watchStatus', params.watchStatus);
  if (params.search) q.set('search', params.search);
  if (params.selectedOnly) q.set('selectedOnly', 'true');
  return fetchJson<{ total: number; items: CuttingRoomCandidate[] }>(
    apiPath(
      `/cutting-room/snapshots/${encodeURIComponent(params.snapshotId)}/candidates${toQuerySuffix(q)}`,
    ),
  );
}

export function listCuttingRoomRootFolders(snapshotId: string) {
  return fetchJson<{
    rootFolders: Array<{ rootFolderPath: string; count: number; bytes: number }>;
  }>(
    apiPath(
      `/cutting-room/snapshots/${encodeURIComponent(snapshotId)}/rootfolders`,
    ),
  );
}

export function autoSelectCandidates(
  snapshotId: string,
  body: {
    targetBytes: number;
    maxTier?: number;
    minScore?: number;
    rootFolder?: string;
  },
) {
  return fetchJson<{ selectedCount: number; selectedBytes: number }>(
    apiPath(
      `/cutting-room/snapshots/${encodeURIComponent(snapshotId)}/selection/auto`,
    ),
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
}

export function patchCandidateSelection(
  snapshotId: string,
  body: {
    ids?: string[];
    all?: boolean;
    selected: boolean;
    maxTier?: number;
    minScore?: number;
    rootFolder?: string;
  },
) {
  return fetchJson<{ selectedCount: number; selectedBytes: number }>(
    apiPath(`/cutting-room/snapshots/${encodeURIComponent(snapshotId)}/candidates`),
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
}

export function startCuttingRoomPrune(
  snapshotId: string,
  body: {
    confirmation: string;
    dryRun?: boolean;
    waveSize?: number;
    removeEntry?: boolean;
    addImportExclusion?: boolean;
  },
) {
  return fetchJson<{ run: JobRun }>(
    apiPath(`/cutting-room/snapshots/${encodeURIComponent(snapshotId)}/prune`),
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
}

export function stopCuttingRoomPrune(snapshotId: string) {
  return fetchJson<{ ok: true }>(
    apiPath(`/cutting-room/snapshots/${encodeURIComponent(snapshotId)}/stop`),
    { method: 'POST', headers: JSON_HEADERS, body: '{}' },
  );
}

export function listPruneHistory(params: {
  take?: number;
  skip?: number;
  mediaType?: string;
  restored?: boolean;
  search?: string;
}) {
  const q = new URLSearchParams();
  if (params.take) q.set('take', String(params.take));
  if (params.skip) q.set('skip', String(params.skip));
  if (params.mediaType) q.set('mediaType', params.mediaType);
  if (params.restored !== undefined) q.set('restored', String(params.restored));
  if (params.search) q.set('search', params.search);
  return fetchJson<{ total: number; items: PruneHistoryItem[] }>(
    apiPath(`/cutting-room/prunes${toQuerySuffix(q)}`),
  );
}

export function restorePrune(pruneId: string) {
  return fetchJson<{ ok: true }>(
    apiPath(`/cutting-room/prunes/${encodeURIComponent(pruneId)}/restore`),
    { method: 'POST', headers: JSON_HEADERS, body: '{}' },
  );
}

export type DuplicateGroup = {
  ratingKey: string;
  librarySectionKey: string;
  sectionTitle?: string;
  title: string | null;
  year: number | null;
  versions: Array<{
    mediaId: string | null;
    videoResolution: string | null;
    sizeBytes: number;
    file: string | null;
  }>;
  totalBytes: number;
  wasteBytes: number;
};

export function listDuplicates(sectionKey?: string) {
  const q = sectionKey ? `?sectionKey=${encodeURIComponent(sectionKey)}` : '';
  return fetchJson<{
    total: number;
    wasteBytes: number;
    groups: DuplicateGroup[];
  }>(apiPath(`/cutting-room/duplicates${q}`));
}

export function startDuplicateCleanup(body: {
  ratingKeys: string[];
  deletePreference: 'smallest_file' | 'largest_file';
  confirmation: string;
  dryRun?: boolean;
}) {
  return fetchJson<{ run: JobRun }>(apiPath('/cutting-room/duplicates/cleanup'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export type LargeFileItem = {
  kind: 'movie' | 'episode';
  title: string;
  showTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  sizeBytes: number;
  path: string | null;
  arrInstanceId: string | null;
  movieId: number | null;
  plexRatingKey: string | null;
};

export function listLargeFiles(
  thresholdGb: number,
  opts?: {
    mediaType?: 'movie' | 'show' | 'both';
    sectionKeys?: string[];
    instanceIds?: string[];
  },
) {
  const params = new URLSearchParams({ threshold: String(thresholdGb) });
  if (opts?.mediaType) params.set('mediaType', opts.mediaType);
  if (opts?.sectionKeys?.length)
    params.set('sectionKeys', opts.sectionKeys.join(','));
  if (opts?.instanceIds?.length)
    params.set('instanceIds', opts.instanceIds.join(','));
  return fetchJson<{
    total: number;
    totalBytes: number;
    items: LargeFileItem[];
  }>(apiPath(`/cutting-room/large-files?${params.toString()}`));
}

export function startLargeFilesReplace(body: {
  items: LargeFileItem[];
  confirmation: string;
  dryRun?: boolean;
}) {
  return fetchJson<{ run: JobRun }>(
    apiPath('/cutting-room/large-files/replace'),
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
}

export function listWanted(params: {
  type: 'radarr' | 'sonarr';
  instanceId?: string;
  take?: number;
  skip?: number;
  search?: string;
}) {
  const q = new URLSearchParams();
  q.set('type', params.type);
  if (params.instanceId) q.set('instanceId', params.instanceId);
  if (params.take) q.set('take', String(params.take));
  if (params.skip) q.set('skip', String(params.skip));
  if (params.search) q.set('search', params.search);
  return fetchJson<{ total: number; items: WantedItem[] }>(
    apiPath(`/cutting-room/wanted${toQuerySuffix(q)}`),
  );
}

export function startWantedPrune(body: {
  type: 'radarr' | 'sonarr';
  instanceId?: string;
  arrIds?: number[];
  all?: boolean;
  mode: 'unmonitor' | 'remove';
  confirmation: string;
  dryRun?: boolean;
  addImportExclusion?: boolean;
}) {
  return fetchJson<{ run: JobRun; targetCount: number }>(
    apiPath('/cutting-room/wanted/prune'),
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
}
