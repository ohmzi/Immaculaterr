import { ApiError, fetchJson } from '@/api/http';
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

export function bootstrap() {
  return fetchJson<BootstrapResponse>('/api/auth/bootstrap');
}

export function me() {
  return fetchJson<MeResponse>('/api/auth/me');
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
  return await fetchJson<LoginKeyResponse>('/api/auth/login-key');
}

async function postWithCredentialEnvelope(params: {
  path: '/api/auth/register' | '/api/auth/login';
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

  return await fetchJson<AuthOkResponse>(params.path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credentialEnvelope: envelope,
      ...(params.captchaToken ? { captchaToken: params.captchaToken } : {}),
    }),
  });
}

async function postWithPlainCredentials(params: {
  path: '/api/auth/register' | '/api/auth/login';
  username: string;
  password: string;
  captchaToken?: string | null;
}): Promise<AuthOkResponse> {
  return await fetchJson<AuthOkResponse>(params.path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      path: '/api/auth/register',
      username: params.username,
      password: params.password,
      captchaToken: params.captchaToken,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return await postWithPlainCredentials({
      path: '/api/auth/register',
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
      path: '/api/auth/login',
      username: params.username,
      password: params.password,
      captchaToken: params.captchaToken,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return await postWithPlainCredentials({
      path: '/api/auth/login',
      username: params.username,
      password: params.password,
      captchaToken: params.captchaToken,
    });
  }
}

export function createLoginChallenge(params: { username: string }) {
  return fetchJson<LoginChallengeResponse>('/api/auth/login-challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function loginWithPasswordProof(params: {
  challengeId: string;
  proof: string;
  captchaToken?: string | null;
}) {
  return fetchJson<AuthOkResponse>('/api/auth/login-proof', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function logout() {
  return fetchJson<LogoutResponse>('/api/auth/logout', { method: 'POST' });
}

export function logoutAll() {
  return fetchJson<LogoutResponse>('/api/auth/logout-all', { method: 'POST' });
}

export function changePassword(params: {
  currentPassword: string;
  newPassword: string;
  captchaToken?: string | null;
}) {
  return fetchJson<{ ok: true; requireReauth: boolean }>(
    '/api/auth/change-password',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
  );
}

export function resetDev() {
  return fetchJson<{ ok: true }>('/api/auth/reset-dev', { method: 'POST' });
}
