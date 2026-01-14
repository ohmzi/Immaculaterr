export const DEFAULT_APP_VERSION = '1.0.0.504';

export type AppMeta = {
  name: string;
  version: string;
  buildSha: string | null;
  buildTime: string | null;
};

export function readAppMeta(): AppMeta {
  // IMPORTANT:
  // - For packaged builds (Docker/Portainer), the version is already baked into the codebase
  //   via DEFAULT_APP_VERSION.
  // - Allowing APP_VERSION to override causes confusing "stuck on old version" situations
  //   when users duplicate/recreate containers and Portainer preserves env vars.
  // If you really need to override for local/dev, set ALLOW_APP_VERSION_OVERRIDE=true.
  const allowOverride = (process.env.ALLOW_APP_VERSION_OVERRIDE ?? '').trim() === 'true';
  const envVersion = (process.env.APP_VERSION ?? '').trim();
  const version =
    allowOverride && envVersion ? envVersion : DEFAULT_APP_VERSION;
  const buildSha = (process.env.APP_BUILD_SHA ?? '').trim() || null;
  const buildTime = (process.env.APP_BUILD_TIME ?? '').trim() || null;

  return {
    name: 'immaculaterr',
    version,
    buildSha,
    buildTime,
  };
}

