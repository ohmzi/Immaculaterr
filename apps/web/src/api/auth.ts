import { ApiError, fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS } from '@/api/constants';
import {
  createPayloadEnvelope,
  type LoginKeyResponse,
} from '@/lib/security/clientCredentialEnvelope';

export type AuthUser = {
  id: string;
  username: string;
};

export type BootstrapResponse = {
  needsAdminSetup: boolean;
  onboardingComplete: boolean;
};

export type MeResponse = { user: AuthUser };
export type AuthOkResponse = { ok: true; user: AuthUser };
export type LogoutResponse = { ok: true };
export type PasswordRecoveryQuestion = {
  key: string;
  prompt: string;
};
export type PasswordRecoveryAnswer = {
  questionKey: string;
  answer: string;
};
export type PasswordRecoveryStatusResponse = {
  required: boolean;
  configured: boolean;
  configuredQuestionKeys: string[];
};
export type PasswordResetChallengeResponse = {
  challengeId: string;
  questions: Array<{
    slot: 1 | 2 | 3;
    questionKey: string;
    prompt: string;
  }>;
  expiresAt: string;
  attemptsRemaining: number;
};

export type LoginChallengeResponse = {
  challengeId: string;
  algorithm: string;
  salt: string;
  iterations: number;
  nonce: string;
  expiresAt: string;
};

type AuthCredentialPath = '/auth/register' | '/auth/login';
type AuthRecoveryPath =
  | '/auth/recovery/configure'
  | '/auth/recovery/reset-password';
type AuthEnvelopePath = AuthCredentialPath | AuthRecoveryPath;

const AUTH_CREDENTIAL_ENVELOPE_PURPOSES = {
  login: 'auth.login',
  register: 'auth.register',
  recoveryConfigure: 'auth.recovery.configure',
  recoveryResetPassword: 'auth.recovery.reset-password',
} as const;
type AuthCredentialEnvelopePurpose =
  (typeof AUTH_CREDENTIAL_ENVELOPE_PURPOSES)[keyof typeof AUTH_CREDENTIAL_ENVELOPE_PURPOSES];

export function bootstrap() {
  return fetchJson<BootstrapResponse>(apiPath('/auth/bootstrap'));
}

export function me() {
  return fetchJson<MeResponse>(apiPath('/auth/me'));
}

export async function getMeOrNull(): Promise<AuthUser | null> {
  try {
    const res = await me();
    return res.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

async function getLoginKey(): Promise<LoginKeyResponse> {
  return await fetchJson<LoginKeyResponse>(apiPath('/auth/login-key'));
}

async function postWithEncryptedAuthPayload<T>(params: {
  path: AuthEnvelopePath;
  purpose: AuthCredentialEnvelopePurpose;
  payload: Record<string, unknown>;
  captchaToken?: string | null;
}): Promise<T> {
  const key = await getLoginKey();
  const envelope = await createPayloadEnvelope({
    key,
    purpose: params.purpose,
    payload: params.payload,
  });

  return await fetchJson<T>(apiPath(params.path), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      credentialEnvelope: envelope,
      ...(params.captchaToken ? { captchaToken: params.captchaToken } : {}),
    }),
  });
}

async function postWithPlainCredentials(params: {
  path: AuthCredentialPath;
  username: string;
  password: string;
  extraBody?: Record<string, unknown>;
  captchaToken?: string | null;
}): Promise<AuthOkResponse> {
  return await fetchJson<AuthOkResponse>(apiPath(params.path), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      username: params.username,
      password: params.password,
      ...(params.extraBody ?? {}),
      ...(params.captchaToken ? { captchaToken: params.captchaToken } : {}),
    }),
  });
}

export async function register(params: {
  username: string;
  password: string;
  recoveryAnswers: PasswordRecoveryAnswer[];
  captchaToken?: string | null;
}) {
  try {
    return await postWithEncryptedAuthPayload<AuthOkResponse>({
      path: '/auth/register',
      purpose: AUTH_CREDENTIAL_ENVELOPE_PURPOSES.register,
      payload: {
        username: params.username,
        password: params.password,
        recoveryAnswers: params.recoveryAnswers,
      },
      captchaToken: params.captchaToken,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return await postWithPlainCredentials({
      path: '/auth/register',
      username: params.username,
      password: params.password,
      extraBody: { recoveryAnswers: params.recoveryAnswers },
      captchaToken: params.captchaToken,
    });
  }
}

export async function login(params: {
  username: string;
  password: string;
  captchaToken?: string | null;
}) {
  try {
    return await postWithEncryptedAuthPayload<AuthOkResponse>({
      path: '/auth/login',
      purpose: AUTH_CREDENTIAL_ENVELOPE_PURPOSES.login,
      payload: {
        username: params.username,
        password: params.password,
      },
      captchaToken: params.captchaToken,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return await postWithPlainCredentials({
      path: '/auth/login',
      username: params.username,
      password: params.password,
      captchaToken: params.captchaToken,
    });
  }
}

export function createLoginChallenge(params: { username: string }) {
  return fetchJson<LoginChallengeResponse>(apiPath('/auth/login-challenge'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
}

export function loginWithPasswordProof(params: {
  challengeId: string;
  proof: string;
  captchaToken?: string | null;
}) {
  return fetchJson<AuthOkResponse>(apiPath('/auth/login-proof'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
}

export function logout() {
  return fetchJson<LogoutResponse>(apiPath('/auth/logout'), { method: 'POST' });
}

export function logoutAll() {
  return fetchJson<LogoutResponse>(apiPath('/auth/logout-all'), { method: 'POST' });
}

export function changePassword(params: {
  currentPassword: string;
  newPassword: string;
  captchaToken?: string | null;
}) {
  return fetchJson<{ ok: true; requireReauth: boolean }>(
    apiPath('/auth/change-password'),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    },
  );
}

export function listPasswordRecoveryQuestions() {
  return fetchJson<{ questions: PasswordRecoveryQuestion[] }>(
    apiPath('/auth/recovery/questions'),
  );
}

export function getPasswordRecoveryStatus() {
  return fetchJson<PasswordRecoveryStatusResponse>(
    apiPath('/auth/recovery/status'),
  );
}

export function configurePasswordRecovery(params: {
  currentPassword: string;
  recoveryAnswers: PasswordRecoveryAnswer[];
}) {
  return postConfigurePasswordRecovery(params);
}

async function postConfigurePasswordRecovery(params: {
  currentPassword: string;
  recoveryAnswers: PasswordRecoveryAnswer[];
}) {
  try {
    return await postWithEncryptedAuthPayload<{ ok: true }>({
      path: '/auth/recovery/configure',
      purpose: AUTH_CREDENTIAL_ENVELOPE_PURPOSES.recoveryConfigure,
      payload: {
        currentPassword: params.currentPassword,
        recoveryAnswers: params.recoveryAnswers,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return await fetchJson<{ ok: true }>(apiPath('/auth/recovery/configure'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    });
  }
}

export function requestPasswordResetQuestions(params: { username: string }) {
  return fetchJson<PasswordResetChallengeResponse>(
    apiPath('/auth/recovery/reset-questions'),
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    },
  );
}

export function resetPasswordWithRecovery(params: {
  challengeId: string;
  newPassword: string;
  answers: Array<{ slot: number; answer: string }>;
}) {
  return postResetPasswordWithRecovery(params);
}

async function postResetPasswordWithRecovery(params: {
  challengeId: string;
  newPassword: string;
  answers: Array<{ slot: number; answer: string }>;
}) {
  try {
    return await postWithEncryptedAuthPayload<{ ok: true }>({
      path: '/auth/recovery/reset-password',
      purpose: AUTH_CREDENTIAL_ENVELOPE_PURPOSES.recoveryResetPassword,
      payload: {
        challengeId: params.challengeId,
        newPassword: params.newPassword,
        answers: params.answers,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return await fetchJson<{ ok: true }>(apiPath('/auth/recovery/reset-password'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(params),
    });
  }
}

export function resetDev() {
  return fetchJson<{ ok: true }>(apiPath('/auth/reset-dev'), { method: 'POST' });
}
