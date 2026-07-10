import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { applyTheme, getInitialTheme, setTheme, type ThemeMode } from '@/app/theme';

const MODES: Array<{ mode: ThemeMode; label: string; icon: typeof Sun }> = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
];

/** Three-way appearance switch (light / dark / follow system). */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => getInitialTheme());

  // While following the system, react live to OS appearance changes.
  useEffect(() => {
    if (mode !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  return (
    <div
      className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1"
      role="group"
      aria-label="Appearance"
    >
      {MODES.map(({ mode: value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTheme(value);
              setMode(value);
            }}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-all',
              active
                ? 'bg-white/15 text-white'
                : 'text-white/50 hover:bg-white/10 hover:text-white/80',
            ].join(' ')}
            aria-pressed={active}
            title={`${label} appearance`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
