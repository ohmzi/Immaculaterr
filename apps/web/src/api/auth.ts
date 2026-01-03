import { ApiError, fetchJson } from '@/api/http';

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

export function register(params: { username: string; password: string }) {
  return fetchJson<AuthOkResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function login(params: { username: string; password: string }) {
  return fetchJson<AuthOkResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function logout() {
  return fetchJson<LogoutResponse>('/api/auth/logout', { method: 'POST' });
}

export function resetDev() {
  return fetchJson<{ ok: true }>('/api/auth/reset-dev', { method: 'POST' });
}

