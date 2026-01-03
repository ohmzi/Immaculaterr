export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'tcp_theme';

function readSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // ignore
  }
  return 'system';
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;

  const isDark = mode === 'dark' || (mode === 'system' && readSystemPrefersDark());
  document.documentElement.classList.toggle('dark', isDark);

  // Helps native form controls + scrollbars match our theme.
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

export function setTheme(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
  applyTheme(mode);
}

