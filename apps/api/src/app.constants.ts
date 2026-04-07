export const API_GLOBAL_PREFIX = 'api';
export const API_PREFIX_PATH = `/${API_GLOBAL_PREFIX}`;
export const API_DOCS_PATH = `${API_GLOBAL_PREFIX}/docs`;
export const API_STATIC_EXCLUDE_PATH = `${API_PREFIX_PATH}{/*path}`;

export const API_DEFAULT_HOST = '0.0.0.0';
export const API_DEFAULT_PORT = 5454;
export const API_DEV_PORT_EXAMPLE = 5859;
export const HTTP_SLOW_REQUEST_THRESHOLD_MS = 1_500;

export const API_RATE_LIMIT_DEFAULT_MAX = 120;
export const API_RATE_LIMIT_DEFAULT_WINDOW_MS = 60_000;

export const AUTH_RATE_LIMIT_DEFAULT_WINDOW_MS = 60_000;
export const AUTH_RATE_LIMIT_DEFAULT_LOGIN_MAX = 10;
export const AUTH_RATE_LIMIT_DEFAULT_REGISTER_MAX = 3;
export const AUTH_RATE_LIMIT_DEFAULT_GET_MAX = 20;

export const WEBHOOK_RATE_LIMIT_DEFAULT_MAX = 30;
export const WEBHOOK_RATE_LIMIT_DEFAULT_WINDOW_MS = 60_000;

export const AUTH_RATE_LIMIT_ROUTES = {
  login: `${API_PREFIX_PATH}/auth/login`,
  register: `${API_PREFIX_PATH}/auth/register`,
  loginChallenge: `${API_PREFIX_PATH}/auth/login-challenge`,
  loginProof: `${API_PREFIX_PATH}/auth/login-proof`,
  passwordResetQuestions: `${API_PREFIX_PATH}/auth/recovery/reset-questions`,
  passwordReset: `${API_PREFIX_PATH}/auth/recovery/reset-password`,
} as const;

export const AUTH_RATE_LIMIT_GET_ROUTES = {
  bootstrap: `${API_PREFIX_PATH}/auth/bootstrap`,
  loginKey: `${API_PREFIX_PATH}/auth/login-key`,
  recoveryQuestions: `${API_PREFIX_PATH}/auth/recovery/questions`,
} as const;

export const AUTH_CREDENTIAL_ENVELOPE_PURPOSES = {
  login: 'auth.login',
  register: 'auth.register',
  recoveryConfigure: 'auth.recovery.configure',
  recoveryResetPassword: 'auth.recovery.reset-password',
} as const;

export const PASSWORD_RECOVERY_REQUIRED_QUESTION_COUNT = 3;
export const PASSWORD_RECOVERY_RESET_QUESTION_COUNT = 2;
export const PASSWORD_RECOVERY_MAX_FAILED_ATTEMPTS = 5;
export const PASSWORD_RECOVERY_LOCKOUT_MS = 15 * 60_000;
export const PASSWORD_RECOVERY_CHALLENGE_TTL_MS = 10 * 60_000;

export const PASSWORD_RECOVERY_SECURITY_QUESTIONS = [
  {
    key: 'first_pet_name',
    prompt: 'What was the name of your first pet?',
  },
  {
    key: 'first_school',
    prompt: 'What is the name of the first school you attended?',
  },
  {
    key: 'birth_city',
    prompt: 'In what city were you born?',
  },
  {
    key: 'favorite_teacher_last_name',
    prompt: "What was your favorite teacher's last name?",
  },
  {
    key: 'childhood_nickname',
    prompt: 'What was your childhood nickname?',
  },
  {
    key: 'favorite_movie_childhood',
    prompt: 'What was your favorite movie as a child?',
  },
] as const;

export const WEBHOOKS_PLEX_ALIAS_PREFIX = '/webhooks/plex';
export const WEBHOOKS_PLEX_CANONICAL_PREFIX = `${API_PREFIX_PATH}/webhooks/plex`;

export const PLEX_OAUTH_POLL_HEADER = 'x-immaculaterr-oauth-poll';

/** Months behind "today" for collection ordering (recent-release slot). */
export const COLLECTION_RECENT_RELEASE_MONTHS = 3;
export const PLEX_OAUTH_POLL_HEADER_VALUE = '1';

/** Maximum time a job run may stay in RUNNING before the watchdog marks it FAILED. */
export const JOB_RUN_TIMEOUT_MS = 30 * 60_000;

/** Minimum delay between consecutive job executions to avoid hammering external APIs. */
export const QUEUE_COOLDOWN_MS = 5 * 60_000;

/** Cap for third-party HTTP response bodies in log output. */
export const LOG_BODY_MAX_LENGTH = 200;

/** Cap for uncontrolled error messages in log output. */
export const LOG_ERROR_MESSAGE_MAX_LENGTH = 500;
