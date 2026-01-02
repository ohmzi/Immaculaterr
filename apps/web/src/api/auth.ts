import { fetchJson } from '@/api/http';

export type BootstrapResponse = {
  needsAdminSetup: boolean;
};

export type MeResponse = {
  user: { id: string; username: string } | null;
};

export async function getBootstrap() {
  return fetchJson<BootstrapResponse>('/api/auth/bootstrap');
}

export async function getMe(): Promise<MeResponse> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return { user: null };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as MeResponse;
}

export async function login(params: { username: string; password: string }) {
  return fetchJson<{ ok: true; user: { id: string; username: string } }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function registerAdmin(params: { username: string; password: string }) {
  return fetchJson<{ ok: true; user: { id: string; username: string } }>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function logout() {
  return fetchJson<{ ok: true }>('/api/auth/logout', { method: 'POST' });
}

export async function resetDev() {
  return fetchJson<{ ok: true }>('/api/auth/reset-dev', { method: 'POST' });
}


