import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function readDocumentTheme(): ToasterProps['theme'] {
  if (typeof document === 'undefined') return 'system';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function Toaster(props: ToasterProps) {
  const [theme, setTheme] = useState<ToasterProps['theme']>(() => readDocumentTheme());

  useEffect(() => {
    const update = () => setTheme(readDocumentTheme());

    // Keep toaster in sync with our class-based theme toggling.
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      position="top-center"
      richColors
      offset={{ top: 88 }}
      mobileOffset={{ top: 76 }}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}
