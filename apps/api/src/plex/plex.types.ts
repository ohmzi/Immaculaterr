export type PlexPin = {
  id: number;
  code: string;
  expiresAt?: string;
  expiresIn?: number;
  authToken?: string | null;
};

export type PlexSharedServerUser = {
  plexAccountId: number | null;
  plexAccountTitle: string | null;
  username: string | null;
  email: string | null;
};
