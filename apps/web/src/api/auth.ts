import { ApiError, fetchJson } from '@/api/http';
import { apiPath, JSON_HEADERS } from '@/api/constants';
import {
  createCredentialEnvelope,
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

export type LoginChallengeResponse = {
  challengeId: string;
  algorithm: string;
  salt: string;
  iterations: number;
  nonce: string;
  expiresAt: string;
};

type AuthCredentialPath = '/auth/register' | '/auth/login';

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

export async function getLoginKey(): Promise<LoginKeyResponse> {
  return await fetchJson<LoginKeyResponse>(apiPath('/auth/login-key'));
}

export async function postWithCredentialEnvelope(params: {
  path: AuthCredentialPath;
  username: string;
  password: string;
  captchaToken?: string | null;
}): Promise<AuthOkResponse> {
  const key = await getLoginKey();
  const envelope = await createCredentialEnvelope({
    username: params.username,
    password: params.password,
    key,
  });

  return await fetchJson<AuthOkResponse>(apiPath(params.path), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      credentialEnvelope: envelope,
      ...(params.captchaToken ? { captchaToken: params.captchaToken } : {}),
    }),
  });
}

export async function postWithPlainCredentials(params: {
  path: AuthCredentialPath;
  username: string;
  password: string;
  captchaToken?: string | null;
}): Promise<AuthOkResponse> {
  return await fetchJson<AuthOkResponse>(apiPath(params.path), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      username: params.username,
      password: params.password,
      ...(params.captchaToken ? { captchaToken: params.captchaToken } : {}),
    }),
  });
}

export async function register(params: {
  username: string;
  password: string;
  captchaToken?: string | null;
}) {
  try {
    return await postWithCredentialEnvelope({
      path: '/auth/register',
      username: params.username,
      password: params.password,
      captchaToken: params.captchaToken,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return await postWithPlainCredentials({
      path: '/auth/register',
      username: params.username,
      password: params.password,
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
    return await postWithCredentialEnvelope({
      path: '/auth/login',
      username: params.username,
      password: params.password,
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

export function resetDev() {
  return fetchJson<{ ok: true }>(apiPath('/auth/reset-dev'), { method: 'POST' });
}
