export type VersionHistorySection = {
  title: string;
  bullets: string[];
};

export type VersionHistoryEntry = {
  version: string;
  popupHighlights: string[];
  sections: VersionHistorySection[];
};

export function normalizeVersion(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^[vV]/, '');
}

export const VERSION_HISTORY_ENTRIES: VersionHistoryEntry[] = [
  {
    version: '1.5.1',
    popupHighlights: [
      'Recommendations (Movies + TV): now personalized per Plex viewer.',
      'Plex pinning: row placement is smarter for admin and shared users.',
      'Plex library selection: safer setup and easier ongoing management.',
      'Overseerr integration: optional centralized missing-request routing.',
      'Observatory: improved stability and easier reject-list workflow.',
      'Task Manager > Cleanup After Adding New Content: independent action toggles.',
    ],
    sections: [
      {
        title: 'Per-viewer personalization (Movies + TV)',
        bullets: [
          'Each Plex viewer gets their own curated rows for recently watched, change of taste, and immaculate taste collections.',
          "Recommendation datasets are isolated per viewer and per library so one viewer does not affect another viewer's rows.",
        ],
      },
      {
        title: 'Role-based Plex pinning',
        bullets: [
          'Admin rows pin to Library Recommended and Home.',
          'Shared-user rows pin to Friends Home to match current Plex shared-user behavior.',
        ],
      },
      {
        title: 'Deterministic curated row ordering',
        bullets: ['Based on your recently watched', 'Change of Taste', 'Inspired by your Immaculate Taste'],
      },
      {
        title: 'Plex library selection guardrails',
        bullets: [
          'Select movie/show libraries during onboarding and later in Command Center.',
          'New Plex movie/show libraries are auto-included unless disabled.',
          'Disabled or temporarily unavailable libraries are skipped safely with clear run report visibility.',
        ],
      },
      {
        title: 'Refresher scoping and scheduling improvements',
        bullets: [
          'Chained refreshes stay scoped to the triggering viewer and library.',
          'Standalone refresher runs sweep eligible users/libraries in deterministic order, with admin processed last.',
        ],
      },
      {
        title: 'Overseerr integration (optional centralized request flow)',
        bullets: [
          'Route missing movie/TV requests to Overseerr per task card.',
          'Command Center includes a reset action for Overseerr requests.',
        ],
      },
      {
        title: 'Observatory workflow upgrades',
        bullets: [
          'Swipe-left now adds suggestions to a rejected list so they are not suggested again.',
          'Command Center can reset the rejected list.',
          'Fixed an Observatory black-screen crash and replaced library selection with a custom glass dropdown.',
        ],
      },
      {
        title: 'Operational visibility and reliability updates',
        bullets: [
          'Expanded user-aware reset/debug controls and clearer user/media run reporting.',
          'Compose keeps host networking while still showing mapped ports.',
          'Removed GitHub token env dependency from update checks.',
        ],
      },
      {
        title: 'Cleanup After Adding New Content',
        bullets: [
          'Choose any combination of duplicate cleanup, ARR unmonitoring, and watchlist removal.',
          'Turning off ARR unmonitoring now disables all ARR monitoring mutations for this task.',
          'If all cleanup toggles are off, the task runs as a no-op and reports skipped actions.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    popupHighlights: [
      'Immaculaterr can auto-run from Plex activity and schedules.',
      'It builds curated rows from what you watch and what you like.',
      'Optional integrations connect suggestions and downloads across your stack.',
      'Observatory helps you quickly approve or skip suggestions.',
      'Rewind gives clear run history and logs.',
    ],
    sections: [
      {
        title: 'Plex-triggered automation',
        bullets: [
          'Automatically reacts to Plex library activity and runs smart workflows in real time.',
        ],
      },
      {
        title: 'Scheduler automation',
        bullets: ['Off hours fetching media or refreshing the Plex home screen.'],
      },
      {
        title: 'Curated Movies and TV Shows collections',
        bullets: [
          'Inspired by your Immaculate Taste (long term collection)',
          'Based on your recently watched (refreshes on every watch)',
          'Change of Taste (refreshes on every watch)',
        ],
      },
      {
        title: 'Recommendation engine',
        bullets: ['TMDB-powered suggestions', 'Optional - Google + OpenAI'],
      },
      {
        title: 'Keeps a snapshot database',
        bullets: [
          'Recommmended database for refresher task to monitor titles as they become available in Plex.',
        ],
      },
      {
        title: 'Radarr + Sonarr integration',
        bullets: [
          'Seamlessly organizes your media collection and automatically sends movies and series to ARR downloaders for monitoring and acquisition.',
        ],
      },
      {
        title: 'Observatory',
        bullets: [
          'Swipe to approve download requests (optional “approval required” mode), curate suggestions.',
        ],
      },
      {
        title: 'Job reports & logs',
        bullets: ['Step-by-step breakdowns, metrics tables, and run history.'],
      },
    ],
  },
];

export function getLatestVersionHistoryEntry(): VersionHistoryEntry | null {
  return VERSION_HISTORY_ENTRIES[0] ?? null;
}

export function getVersionHistoryEntry(version: string | null | undefined): VersionHistoryEntry | null {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  return (
    VERSION_HISTORY_ENTRIES.find(
      (entry) => normalizeVersion(entry.version) === normalized,
    ) ?? null
  );
}
