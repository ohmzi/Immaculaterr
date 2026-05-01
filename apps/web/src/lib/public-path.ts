const ABSOLUTE_URL_REGEX = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const TRAILING_SLASHES_REGEX = /\/+$/;

function normalizeBasePath(pathname: string): string {
  const trimmed = (pathname ?? '').trim();
  if (!trimmed || trimmed === '/') return '';

  const normalized = trimmed.replace(TRAILING_SLASHES_REGEX, '');
  return normalized === '/' ? '' : normalized;
}

function isAlreadyPrefixed(basePath: string, path: string): boolean {
  if (!basePath) return false;
  return path === basePath || path.startsWith(`${basePath}/`);
}

export function getPublicBasePath(): string {
  if (typeof document === 'undefined' || !document.baseURI) return '';

  try {
    return normalizeBasePath(new URL(document.baseURI).pathname);
  } catch {
    return '';
  }
}

export function withPublicBasePath(path: `/${string}` | '/'): string {
  const basePath = getPublicBasePath();
  if (!basePath) return path;
  if (isAlreadyPrefixed(basePath, path)) return path;
  if (path === '/') return `${basePath}/`;
  return `${basePath}${path}`;
}

export function toPublicHref(href: string): string {
  const trimmed = (href ?? '').trim();
  if (!trimmed) return trimmed;
  if (ABSOLUTE_URL_REGEX.test(trimmed) || trimmed.startsWith('//')) {
    return trimmed;
  }
  if (!trimmed.startsWith('/')) return trimmed;

  try {
    const url = new URL(trimmed, window.location.origin);
    const basePath = getPublicBasePath();
    if (isAlreadyPrefixed(basePath, url.pathname)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return `${withPublicBasePath(url.pathname as `/${string}` | '/')}${url.search}${url.hash}`;
  } catch {
    return withPublicBasePath(trimmed as `/${string}` | '/');
  }
}
