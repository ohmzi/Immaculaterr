export const API_GLOBAL_PREFIX = 'api';
export const API_PREFIX_PATH = `/${API_GLOBAL_PREFIX}`;
export const API_DOCS_PATH = `${API_GLOBAL_PREFIX}/docs`;
export const API_STATIC_EXCLUDE_PATH = `${API_PREFIX_PATH}{/*path}`;

export const API_DEFAULT_HOST = '0.0.0.0';
export const API_DEFAULT_PORT = 5454;
export const API_DEV_PORT_EXAMPLE = 5859;
export const HTTP_SLOW_REQUEST_THRESHOLD_MS = 1_500;

export const AUTH_RATE_LIMIT_DEFAULT_WINDOW_MS = 60_000;
export const AUTH_RATE_LIMIT_DEFAULT_LOGIN_MAX = 10;
export const AUTH_RATE_LIMIT_DEFAULT_REGISTER_MAX = 3;

export const AUTH_RATE_LIMIT_ROUTES = {
  login: `${API_PREFIX_PATH}/auth/login`,
  register: `${API_PREFIX_PATH}/auth/register`,
  loginChallenge: `${API_PREFIX_PATH}/auth/login-challenge`,
  loginProof: `${API_PREFIX_PATH}/auth/login-proof`,
} as const;

export const WEBHOOKS_PLEX_ALIAS_PREFIX = '/webhooks/plex';
export const WEBHOOKS_PLEX_CANONICAL_PREFIX = `${API_PREFIX_PATH}/webhooks/plex`;
