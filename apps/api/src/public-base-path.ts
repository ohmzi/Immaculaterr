import type { NextFunction, Request, Response } from 'express';
import { API_PREFIX_PATH, API_STATIC_EXCLUDE_PATH } from './app.constants';

const APP_BASE_PATH_INVALID_MESSAGE =
  'APP_BASE_PATH must be empty or start with "/" and must not include query or hash fragments.';

const TRAILING_SLASHES_REGEX = /\/+$/;
const INVALID_BASE_PATH_CHARS_REGEX = /[?#]/;

export function normalizeAppBasePath(raw: string | null | undefined): string {
  const value = `${raw ?? ''}`.trim();
  if (!value || value === '/') return '';
  if (!value.startsWith('/') || INVALID_BASE_PATH_CHARS_REGEX.test(value)) {
    throw new Error(APP_BASE_PATH_INVALID_MESSAGE);
  }

  const normalized = value.replace(TRAILING_SLASHES_REGEX, '');
  return normalized || '';
}

export function readAppBasePath(raw = process.env.APP_BASE_PATH): string {
  return normalizeAppBasePath(raw);
}

export function joinWithAppBasePath(
  basePath: string,
  path: `/${string}` | '/',
): string {
  if (path === '/') return basePath ? `${basePath}/` : '/';
  return basePath ? `${basePath}${path}` : path;
}

export function buildPrefixedApiPath(basePath: string): string {
  return joinWithAppBasePath(basePath, API_PREFIX_PATH);
}

export function buildPrefixedStaticExcludePath(basePath: string): string {
  if (!basePath) return API_STATIC_EXCLUDE_PATH;
  return `${buildPrefixedApiPath(basePath)}{/*path}`;
}

export function buildAppRenderPath(basePath: string): string {
  return basePath ? '{*path}' : '';
}

export function createAppBasePathApiRewriteMiddleware(basePath: string) {
  if (!basePath) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const publicApiPath = buildPrefixedApiPath(basePath);
  const publicApiPathWithSlash = `${publicApiPath}/`;
  const publicApiPathWithQuery = `${publicApiPath}?`;

  return (req: Request, _res: Response, next: NextFunction) => {
    const url = req.url || '';
    if (
      url === publicApiPath ||
      url.startsWith(publicApiPathWithSlash) ||
      url.startsWith(publicApiPathWithQuery)
    ) {
      req.url = `${API_PREFIX_PATH}${url.slice(publicApiPath.length)}`;
    }
    next();
  };
}

export function createAppBasePathRootRedirectMiddleware(basePath: string) {
  const redirectTarget = joinWithAppBasePath(basePath, '/');

  return (req: Request, res: Response, next: NextFunction) => {
    if (
      !basePath ||
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      req.url !== '/'
    ) {
      next();
      return;
    }

    res.redirect(302, redirectTarget);
  };
}
