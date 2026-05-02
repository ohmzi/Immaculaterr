import { APP_VERSION } from './version';

export const DEFAULT_APP_VERSION = APP_VERSION;

export type AppMeta = {
  name: string;
  version: string;
  buildSha: string | null;
  buildTime: string | null;
};

export function readAppMeta(): AppMeta {
  // IMPORTANT:
  // - For packaged builds (Docker/Portainer), the image bakes the exact runtime version into
  //   APP_IMAGE_VERSION.
  // - Falling back to DEFAULT_APP_VERSION keeps local/dev builds working without Docker metadata.
  // - Allowing APP_VERSION to override causes confusing "stuck on old version" situations
  //   when users duplicate/recreate containers and Portainer preserves env vars.
  // If you really need to override for local/dev, set ALLOW_APP_VERSION_OVERRIDE=true.
  const allowOverride =
    (process.env.ALLOW_APP_VERSION_OVERRIDE ?? '').trim() === 'true';
  const imageVersion = (process.env.APP_IMAGE_VERSION ?? '').trim();
  const envVersion = (process.env.APP_VERSION ?? '').trim();
  const version =
    imageVersion ||
    (allowOverride && envVersion ? envVersion : DEFAULT_APP_VERSION);
  const buildSha = (process.env.APP_BUILD_SHA ?? '').trim() || null;
  const buildTime = (process.env.APP_BUILD_TIME ?? '').trim() || null;

  return {
    name: 'immaculaterr',
    version,
    buildSha,
    buildTime,
  };
}
