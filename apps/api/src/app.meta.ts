export const DEFAULT_APP_VERSION = '0.0.0.301';

export type AppMeta = {
  name: string;
  version: string;
  buildSha: string | null;
  buildTime: string | null;
};

export function readAppMeta(): AppMeta {
  const version = (process.env.APP_VERSION ?? '').trim() || DEFAULT_APP_VERSION;
  const buildSha = (process.env.APP_BUILD_SHA ?? '').trim() || null;
  const buildTime = (process.env.APP_BUILD_TIME ?? '').trim() || null;

  return {
    name: 'immaculaterr',
    version,
    buildSha,
    buildTime,
  };
}

