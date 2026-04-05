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

export function formatDisplayVersion(value: string | null | undefined): string | null {
  const normalized = normalizeVersion(value);
  if (!normalized) return null;
  return normalized.replace(/-beta\b/i, ' beta');
}

export const VERSION_HISTORY_ENTRIES: VersionHistoryEntry[] = [
  {
    version: '1.7.5',
    popupHighlights: [
      'Recommendations now respect each profile\'s genre and language rules so unrelated titles are filtered before scoring.',
      'Sessions last 30 days with a rolling window, and API rate limiting protects auth, webhooks, and general endpoints.',
      'All pinning jobs now include Fresh Out Of The Oven in the hub order so it stays in position between runs.',
      'Secrets vault and Overseerr setup work in environments where WebCrypto is unavailable.',
      'Database migration repair is more resilient with better diagnostics for blocked deploys.',
    ],
    sections: [
      {
        title: 'Profile-aware recommendation filtering',
        bullets: [
          'TMDB recommendations are validated against each Immaculate Taste profile\'s genre and language include/exclude rules before points are applied.',
          'Filtering uses existing TMDB detail responses so there are no additional API requests per recommendation.',
          'Profiles configured for specific genres no longer receive unrelated titles that would dilute the collection.',
        ],
      },
      {
        title: 'Session lifetime and API rate limiting',
        bullets: [
          'Session expiration extended from 24 hours to 30 days with a rolling window that resets on each authenticated request.',
          'Global API rate limit (120 requests per 60 seconds per IP) protects all endpoints.',
          'Per-route throttles on auth, password change, and Plex webhook endpoints add additional safeguards.',
          'Webhook payload deduplication cache prevents duplicate processing within a 30-second window.',
        ],
      },
      {
        title: 'Unified collection hub order',
        bullets: [
          'Webhook-triggered and Immaculate Taste refresher jobs now include Fresh Out Of The Oven in the movie hub order.',
          'Fresh Out visibility (Home for admin, Shared Home for shared users) is centrally enforced regardless of which job triggers pinning.',
          'Previously Fresh Out could be displaced until its own nightly job ran; now all pinning events assert the correct 4-position order.',
        ],
      },
      {
        title: 'Secrets and Overseerr compatibility',
        bullets: [
          'Vault page falls back to plaintext when WebCrypto is not available, fixing blank-state issues in certain Docker or non-HTTPS setups.',
          'Overseerr setup wizard now supports plaintext authentication alongside encrypted credential flow.',
        ],
      },
      {
        title: 'Migration repair and dependency updates',
        bullets: [
          'Migration repair script logs diagnostics for blocked deploys and reconciles stuck migration rows so Prisma can rerun them safely.',
          'Updated fast-xml-parser, file-type, and flatted to patched versions addressing upstream security advisories.',
        ],
      },
    ],
  },
  {
    version: '1.7.1',
    popupHighlights: [
      'Fresh Out Of The Oven now builds per-user recent-release movie rows and includes a dedicated Task Manager card.',
      'TMDB Upcoming Movie task adds customizable filter sets and routes top picks to Radarr or Seerr.',
      'TMDB, OpenAI, and Google tests now retry with explicit IPv4 fallback when Docker DNS/IPv6 is unstable.',
      'Setup guidance now includes both TrueNAS and Unraid paths with HTTPS and certificate trust steps.',
    ],
    sections: [
      {
        title: 'Fresh Out Of The Oven task',
        bullets: [
          'Added a per-user recent-release movie collection built from the last 3 months of library titles.',
          'Each user only sees titles they have not watched, while the shared recent-release baseline stays user-independent.',
          'Fresh Out Of The Oven pins to Home for admin, Shared Home for shared users, and stays last within Immaculaterr-managed movie rows.',
          'Task Manager now includes a Fresh Out Of The Oven job with Run Now plus optional schedule enablement.',
        ],
      },
      {
        title: 'TMDB Upcoming Movie task',
        bullets: [
          'Added customizable filter sets with where-to-watch, genre, language, certification, and score controls.',
          'Each filter set can be tuned independently so upcoming picks match different preferences or use cases.',
          'Top picks can route directly to Radarr by default or through Seerr when route-via-Seerr is enabled.',
        ],
      },
      {
        title: 'Integration connectivity hardening',
        bullets: [
          'TMDB, OpenAI, and Google now retry with explicit IPv4 fallback when normal requests fail due to DNS/IPv6 network issues.',
          'This improves API-key validation reliability in Docker environments with unstable resolver behavior.',
          'Added focused test coverage for fallback behavior and non-fallback auth failure handling.'
        ],
      },
      {
        title: 'TrueNAS and Unraid setup guidance',
        bullets: [
          'Added dedicated in-app setup guides at /setup/truenas and /setup/unraid with copy-ready app and HTTPS-sidecar examples.',
          'Setup page catalog now links directly to both TrueNAS and Unraid guides for faster onboarding.',
          'Updated setup docs with TrueNAS and Unraid deployment flows, local CA trust steps, and HTTPS verification commands.',
        ],
      },
    ],
  },
  {
    version: '1.7.0',
    popupHighlights: [
      'Immaculate Taste profiles now support separate collection strategies with their own rules.',
      'Multiple collections can run together, each with its own Radarr/Sonarr route.',
      'Include/exclude genre and audio-language filters keep recommendations closer to each profile goal.',
      'Default behavior stays simple, and advanced profile controls appear only when needed.',
      'Custom poster upload makes Immaculaterr collections more personal and easier to recognize in Plex.',
      'Forgot-password and password reset are now available with account security questions.',
    ],
    sections: [
      {
        title: 'Password recovery and reset',
        bullets: [
          'Added forgot-password and password reset using security-question verification.',
          'Prompting pre-existing profile with Forced password recovery upon update.',
          'New Profile Page for password recovery management and changing password.',
        ],
      },
      {
        title: 'Profile lanes for Immaculate Taste collections',
        bullets: [
          'Immaculate Taste profiles let each collection strategy run with its own rules.',
          'Multiple collections can run at the same time with different smart filters.',
          'Each profile can follow its own Radarr/Sonarr route so requests go to the right server.',
          'Default behavior stays simple, and advanced profile controls only appear when needed.',
        ],
      },
      {
        title: 'Smart filters for Immaculate Taste',
        bullets: [
          'Include/exclude filters for genre and audio language make profile tuning simple.',
          "Profile rules keep recommendations closer to each profile's goal.",
          'This keeps unwanted titles out and makes results feel more accurate.',
        ],
      },
      {
        title: 'Poster style control',
        bullets: [
          'Custom poster upload is available for all collections created by Immaculaterr.',
          'Poster files stay saved in app data so the look remains consistent after restarts.',
          'Collections are easier to recognize and feel more personalized in Plex.',
        ],
      },
    ],
  },
  {
    version: '1.6.1',
    popupHighlights: [
      'API keys are better protected during setup and connection tests.',
      'After setup, the app avoids sending raw keys whenever possible.',
      'Secret fields always stay hidden as ******* with no reveal option.',
      'HTTP remains on 5454 and HTTPS is available on 5464.',
      'Behind-the-scenes security updates improved runtime safety.',
      'Recommendations are personalized for each Plex user.',
      'Plex pinning behaves better for admin and shared users.',
      'You can disable monitoring for any Plex user.',
      'Plex library selection is safer and easier to manage.',
      'Seerr support is optional for missing requests.',
      'Observatory is more stable with a simpler reject flow.',
      'Cleanup task actions can be toggled independently.',
    ],
    sections: [
      {
        title: 'Better API key protection',
        bullets: [
          'API keys are protected when you save settings and run tests.',
          'Unsafe key submissions are blocked by default.',
        ],
      },
      {
        title: 'Less key exposure after setup',
        bullets: [
          'Follow-up actions use secure references instead of full raw keys.',
          'Settings show key status only, not full key values.',
        ],
      },
      {
        title: 'Vault privacy',
        bullets: [
          'Secret fields always display as *******.',
          'Secret values cannot be revealed in the UI.',
        ],
      },
      {
        title: 'Access and compatibility',
        bullets: [
          'HTTP on 5454 remains available for compatibility.',
          'HTTPS on 5464 is available for encrypted local and LAN access.',
        ],
      },
      {
        title: 'Security test coverage',
        bullets: [
          'Added tests for key handling and transport safety.',
        ],
      },
      {
        title: 'Behind-the-scenes security updates',
        bullets: [
          'Updated vulnerable dependencies to safer versions.',
          'Hardened runtime dependencies used by the container image.',
          'Removed development-only dependency chains from runtime image layers.',
        ],
      },
    ],
  },
  {
    version: '1.5.2',
    popupHighlights: [
      'Recommendations (Movies + TV): now personalized per Plex viewer.',
      'Plex pinning: row placement is smarter for admin and shared users.',
      'Plex user monitoring: toggle any user off so auto-triggered tasks skip them.',
      'Plex library selection: safer setup and easier ongoing management.',
      'Seerr integration: optional centralized missing-request routing.',
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
        title: 'Seerr integration (optional centralized request flow)',
        bullets: [
          'Route missing movie/TV requests to Seerr per task card.',
          'Command Center includes a reset action for Seerr requests.',
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
          'Plex user monitoring can be toggled per user; auto-triggered jobs skip users who are turned off.',
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
