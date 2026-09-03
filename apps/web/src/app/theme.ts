export type ThemeMode = 'light' | 'dark' | 'system';

function readSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;

  const isDark = mode === 'dark' || (mode === 'system' && readSystemPrefersDark());
  document.documentElement.classList.toggle('dark', isDark);

  // Helps native form controls + scrollbars match our theme.
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

