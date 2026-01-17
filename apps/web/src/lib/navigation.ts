import { useCallback } from 'react';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';

const ROUTER_PATH_DATA_KEY = 'routerPath';

const getRouterPath = (): string | null => {
  if (typeof document === 'undefined') return null;
  return document.body?.dataset?.[ROUTER_PATH_DATA_KEY] ?? null;
};

const buildHref = (to: To): string => {
  if (typeof to === 'string') return to;
  const pathname = to.pathname ?? '';
  const search = to.search ?? '';
  const hash = to.hash ?? '';
  return `${pathname}${search}${hash}`;
};

const normalizePath = (href: string): string => {
  const trimmed = (href ?? '').trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed, window.location.origin).pathname;
  } catch {
    return trimmed;
  }
};

export function useSafeNavigate() {
  const navigate = useNavigate();

  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        navigate(to);
        return;
      }

      const href = buildHref(to);
      const destPath = normalizePath(href);

      navigate(to, options);

      if (!destPath) return;

      window.setTimeout(() => {
        try {
          const routerPath = getRouterPath();
          if (routerPath && routerPath !== destPath) {
            window.location.assign(href || destPath);
          }
        } catch {
          // ignore
        }
      }, 120);
    },
    [navigate],
  );
}
