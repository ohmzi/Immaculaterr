const DEBUGGER_TOKEN_STORAGE_KEY = 'immaculaterr_debugger_token_v1';
const DEBUGGER_ROUTE_PREFIX = '/__debug';

const canUseSessionStorage = () => {
  try {
    return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
  } catch {
    return false;
  }
};

const randomToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
};

export const getDebuggerToken = (): string | null => {
  if (!canUseSessionStorage()) return null;
  try {
    return window.sessionStorage.getItem(DEBUGGER_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

const setDebuggerToken = (token: string) => {
  if (!canUseSessionStorage()) return;
  try {
    window.sessionStorage.setItem(DEBUGGER_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
};

export const rotateDebuggerToken = (): string => {
  const token = randomToken();
  setDebuggerToken(token);
  return token;
};

export const createDebuggerUrl = (): string => {
  const token = rotateDebuggerToken();
  return `${DEBUGGER_ROUTE_PREFIX}/${token}`;
};

export const isDebuggerAccessAllowed = (token?: string | null): boolean => {
  if (!token) return false;
  const stored = getDebuggerToken();
  return Boolean(stored && stored === token);
};
