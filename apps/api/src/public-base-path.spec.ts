import { buildAppRenderPath, normalizeAppBasePath } from './public-base-path';

describe('public base path helpers', () => {
  it('normalizes empty and root values to no prefix', () => {
    expect(normalizeAppBasePath(undefined)).toBe('');
    expect(normalizeAppBasePath('')).toBe('');
    expect(normalizeAppBasePath('/')).toBe('');
    expect(normalizeAppBasePath('  /  ')).toBe('');
  });

  it('strips trailing slashes from slash-prefixed paths', () => {
    expect(normalizeAppBasePath('/immaculaterr')).toBe('/immaculaterr');
    expect(normalizeAppBasePath('/immaculaterr/')).toBe('/immaculaterr');
    expect(normalizeAppBasePath('/immaculaterr///')).toBe('/immaculaterr');
    expect(normalizeAppBasePath(' /nested/path/ ')).toBe('/nested/path');
  });

  it('rejects invalid APP_BASE_PATH values', () => {
    expect(() => normalizeAppBasePath('recommendations')).toThrow(
      /APP_BASE_PATH/,
    );
    expect(() => normalizeAppBasePath('http://example.com/path')).toThrow(
      /APP_BASE_PATH/,
    );
    expect(() => normalizeAppBasePath('/immaculaterr?x=1')).toThrow(
      /APP_BASE_PATH/,
    );
    expect(() => normalizeAppBasePath('/immaculaterr#hash')).toThrow(
      /APP_BASE_PATH/,
    );
  });

  it('uses the render path shape Nest can append to a prefixed static mount', () => {
    expect(buildAppRenderPath('')).toBe('');
    expect(buildAppRenderPath('/immaculaterr')).toBe('{*path}');
  });
});
