/**
 * Optional centralized query keys for React Query.
 * Keep these stable to avoid accidental cache misses.
 */
export const queryKeys = {
  auth: {
    bootstrap: ['auth', 'bootstrap'] as const,
    me: ['auth', 'me'] as const,
  },
  settings: ['settings'] as const,
  collections: ['collections'] as const,
  logs: ['serverLogs'] as const,
} as const;

