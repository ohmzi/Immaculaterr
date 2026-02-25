import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function readDocumentTheme(): ToasterProps['theme'] {
  if (typeof document === 'undefined') return 'system';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function Toaster(props: ToasterProps) {
  const [theme, setTheme] = useState<ToasterProps['theme']>(() => readDocumentTheme());
  const {
    className,
    mobileOffset,
    offset,
    position,
    richColors,
    style,
    toastOptions,
    ...rest
  } = props;

  useEffect(() => {
    const update = () => setTheme(readDocumentTheme());

    // Keep toaster in sync with our class-based theme toggling.
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  const mergedClassName = className ? `toaster group ${className}` : 'toaster group';
  const mergedStyle = {
    '--normal-bg': 'rgba(var(--tcp-surface-rgb), 0.92)',
    '--normal-bg-hover': 'rgba(var(--tcp-surface-rgb), 0.98)',
    '--normal-border': 'rgba(255, 255, 255, 0.14)',
    '--normal-border-hover': 'rgba(255, 255, 255, 0.22)',
    '--normal-text': 'rgba(255, 255, 255, 0.96)',
    '--success-bg': 'rgba(var(--tcp-surface-rgb), 0.92)',
    '--success-border': 'rgba(52, 211, 153, 0.48)',
    '--success-text': 'rgba(255, 255, 255, 0.96)',
    '--info-bg': 'rgba(var(--tcp-surface-rgb), 0.92)',
    '--info-border': 'rgba(56, 189, 248, 0.45)',
    '--info-text': 'rgba(255, 255, 255, 0.96)',
    '--warning-bg': 'rgba(var(--tcp-surface-rgb), 0.92)',
    '--warning-border': 'rgba(250, 204, 21, 0.5)',
    '--warning-text': 'rgba(255, 255, 255, 0.96)',
    '--error-bg': 'rgba(var(--tcp-surface-rgb), 0.92)',
    '--error-border': 'rgba(251, 113, 133, 0.5)',
    '--error-text': 'rgba(255, 255, 255, 0.96)',
    ...style,
  } as CSSProperties;

  const mergedToastOptions: ToasterProps['toastOptions'] = {
    ...toastOptions,
    classNames: {
      toast:
        'rounded-2xl border backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.48)] text-white',
      content: 'gap-1.5',
      title: 'text-sm font-semibold tracking-tight text-white',
      description: 'text-xs text-white/75',
      icon: 'text-[#facc15]',
      closeButton:
        'border-white/20 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white',
      success: 'border-emerald-300/45',
      error: 'border-rose-300/50',
      info: 'border-sky-300/45',
      warning: 'border-amber-300/50',
      loading: 'border-[#facc15]/45',
      ...toastOptions?.classNames,
    },
  };

  return (
    <Sonner
      {...rest}
      theme={theme}
      position={position ?? 'top-center'}
      richColors={richColors ?? true}
      offset={offset ?? { top: 88 }}
      mobileOffset={mobileOffset ?? { top: 76 }}
      className={mergedClassName}
      style={mergedStyle}
      toastOptions={mergedToastOptions}
    />
  );
}
