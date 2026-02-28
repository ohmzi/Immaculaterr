import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ensureBootstrapEnv } from './bootstrap-env';
import { BufferedLogger } from './logs/buffered-logger';
import { createOriginCheckMiddleware } from './security/origin-check.middleware';
import { createIpRateLimitMiddleware } from './security/ip-rate-limit.middleware';
import { privateCacheMiddleware } from './security/private-cache.middleware';
import { securityHeadersMiddleware } from './security/security-headers.middleware';
import { readAppMeta } from './app.meta';
import { PlexUsersService } from './plex/plex-users.service';
import {
  API_DEFAULT_HOST,
  API_DEFAULT_PORT,
  API_DEV_PORT_EXAMPLE,
  API_DOCS_PATH,
  API_GLOBAL_PREFIX,
  API_PREFIX_PATH,
  AUTH_RATE_LIMIT_DEFAULT_LOGIN_MAX,
  AUTH_RATE_LIMIT_DEFAULT_REGISTER_MAX,
  AUTH_RATE_LIMIT_DEFAULT_WINDOW_MS,
  AUTH_RATE_LIMIT_ROUTES,
  HTTP_SLOW_REQUEST_THRESHOLD_MS,
  WEBHOOKS_PLEX_ALIAS_PREFIX,
  WEBHOOKS_PLEX_CANONICAL_PREFIX,
} from './app.constants';

function ensureLegacyGlobals() {
  const g = globalThis as Record<string, unknown>;
  if (!('alternateFormatName' in g)) {
    g['alternateFormatName'] = '';
    try {
      const evalFn =
        typeof g['eval'] === 'function'
          ? (g['eval'] as (code: string) => unknown)
          : null;
      evalFn?.('var alternateFormatName = ""');
    } catch {
      // best-effort only
    }
  }
}

function parseTrustProxyEnv(
  raw: string | undefined,
): boolean | number | string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  const lower = value.toLowerCase();
  if (lower === 'true' || lower === 'yes' || lower === 'on') return true;
  if (lower === 'false' || lower === 'no' || lower === 'off') return false;

  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);

  // Allow Express "trust proxy" presets like:
  // - "loopback, linklocal, uniquelocal"
  // - "172.16.0.0/12"
  return value;
}

function parsePositiveIntegerEnv(
  raw: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(raw ?? `${fallback}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function bootstrap() {
  await ensureBootstrapEnv();
  ensureLegacyGlobals();
  const bootstrapLogger = new Logger('Bootstrap');

  process.on('unhandledRejection', (reason) => {
    bootstrapLogger.error(`Unhandled rejection: ${String(reason)}`);
  });
  process.on('uncaughtException', (err) => {
    bootstrapLogger.error(`Uncaught exception: ${err?.stack ?? String(err)}`);
    process.exit(1);
  });

  const app = await NestFactory.create(AppModule, {
    logger: new BufferedLogger(),
  });

  // Transition safety: keep PlexUser admin/backfill state consistent across legacy DB upgrades.
  try {
    const plexUsers = app.get(PlexUsersService);
    await plexUsers.ensureAdminPlexUser({ userId: null });
    await plexUsers.backfillAdminOnMissing();
  } catch (err) {
    bootstrapLogger.warn(
      `Plex user transition guard skipped: ${(err as Error)?.message ?? String(err)}`,
    );
  }

  // Reverse-proxy correctness (req.ip, req.secure, etc.). Configurable via TRUST_PROXY.
  // Defaults to 1 hop in production to support typical single reverse-proxy deployments.
  const trustProxy =
    parseTrustProxyEnv(process.env.TRUST_PROXY) ??
    (process.env.NODE_ENV === 'production' ? 1 : undefined);
  if (trustProxy !== undefined) {
    const httpAdapter = app.getHttpAdapter();
    // Nest uses Express by default; set trust proxy on the underlying Express app instance.
    (
      httpAdapter.getInstance() as { set?: (k: string, v: unknown) => void }
    )?.set?.('trust proxy', trustProxy);
  }

  app.use(securityHeadersMiddleware);
  app.use(privateCacheMiddleware);
  app.use(cookieParser());

  // Compatibility: people (and some guides) often paste Plex webhook URLs without the `/api` prefix.
  // Accept `/webhooks/plex` as an alias for `/api/webhooks/plex`.
  const webhookAliasPrefixRegex = new RegExp(
    `^${escapeRegex(WEBHOOKS_PLEX_ALIAS_PREFIX)}(?:/)?(?:\\?|$)`,
  );
  const webhookAliasPrefixReplaceRegex = new RegExp(
    `^${escapeRegex(WEBHOOKS_PLEX_ALIAS_PREFIX)}(?:/)?`,
  );
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const url = req.url || '';
    if (webhookAliasPrefixRegex.test(url)) {
      req.url = url.replace(
        webhookAliasPrefixReplaceRegex,
        WEBHOOKS_PLEX_CANONICAL_PREFIX,
      );
    }
    next();
  });

  // Keep the API surface separate from the UI routes we’ll serve later.
  app.setGlobalPrefix(API_GLOBAL_PREFIX);

  // CORS: in production default to same-origin (no CORS). Enable only via CORS_ORIGINS allowlist.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV !== 'production') {
    // Dev-friendly defaults (Vite proxy, etc.)
    app.enableCors({
      origin: true,
      credentials: true,
    });
  } else if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
    });
  }

  // Lightweight CSRF/origin defense for state-changing requests.
  app.use(
    API_PREFIX_PATH,
    createOriginCheckMiddleware({ allowedOrigins: corsOrigins }),
  );

  // Auth rate limiting (in-memory, per-IP).
  const authRateLimitWindowMs = parsePositiveIntegerEnv(
    process.env.AUTH_RATE_LIMIT_WINDOW_MS,
    AUTH_RATE_LIMIT_DEFAULT_WINDOW_MS,
  );
  const authLoginMax = parsePositiveIntegerEnv(
    process.env.AUTH_RATE_LIMIT_MAX_LOGIN,
    AUTH_RATE_LIMIT_DEFAULT_LOGIN_MAX,
  );
  const authRegisterMax = parsePositiveIntegerEnv(
    process.env.AUTH_RATE_LIMIT_MAX_REGISTER,
    AUTH_RATE_LIMIT_DEFAULT_REGISTER_MAX,
  );

  const authRateLimitRoutes = [
    {
      path: AUTH_RATE_LIMIT_ROUTES.login,
      max: authLoginMax,
      keyPrefix: 'auth_login',
    },
    {
      path: AUTH_RATE_LIMIT_ROUTES.register,
      max: authRegisterMax,
      keyPrefix: 'auth_register',
    },
    {
      path: AUTH_RATE_LIMIT_ROUTES.loginChallenge,
      max: authLoginMax,
      keyPrefix: 'auth_login_challenge',
    },
    {
      path: AUTH_RATE_LIMIT_ROUTES.loginProof,
      max: authLoginMax,
      keyPrefix: 'auth_login_proof',
    },
  ] as const;

  for (const route of authRateLimitRoutes) {
    app.use(
      route.path,
      createIpRateLimitMiddleware({
        windowMs: authRateLimitWindowMs,
        max: route.max,
        keyPrefix: route.keyPrefix,
        methods: ['POST'],
      }),
    );
  }

  // Lightweight request logging (only warnings/errors/slow requests)
  const httpLoggingEnabled =
    process.env.HTTP_LOGGING === 'true' ||
    process.env.NODE_ENV !== 'production';
  if (httpLoggingEnabled) {
    const httpLogger = new Logger('HTTP');
    app.use((req: Request, res: Response, next: NextFunction) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const status = res.statusCode;
        const path = req.originalUrl || req.url;
        const msg = `${req.method} ${path} -> ${status} ${ms.toFixed(0)}ms`;

        if (status >= 500) httpLogger.error(msg);
        else if (status >= 400) httpLogger.warn(msg);
        else if (ms >= HTTP_SLOW_REQUEST_THRESHOLD_MS)
          httpLogger.warn(`SLOW ${msg}`);
      });
      next();
    });
  }

  const swaggerEnabled =
    process.env.SWAGGER_ENABLED === 'true' ||
    process.env.NODE_ENV !== 'production';
  if (swaggerEnabled) {
    const meta = readAppMeta();
    const config = new DocumentBuilder()
      .setTitle('Immaculaterr API')
      .setDescription('Local API for the Immaculaterr webapp.')
      .setVersion(meta.version)
      .build();

    const document = SwaggerModule.createDocument(app, config);
    // Note: Swagger routes are not affected by Nest's globalPrefix; include it explicitly.
    SwaggerModule.setup(API_DOCS_PATH, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // Default away from 3000 (commonly taken on dev machines).
  const port = Number.parseInt(process.env.PORT ?? `${API_DEFAULT_PORT}`, 10);
  const host = process.env.HOST ?? API_DEFAULT_HOST;
  try {
    await app.listen(port, host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EADDRINUSE') {
      bootstrapLogger.error(
        `Port ${port} is already in use. Stop the other process or set PORT to a free port.`,
      );
      bootstrapLogger.error(
        `Example: PORT=${API_DEV_PORT_EXAMPLE} npm run dev:api`,
      );
      process.exit(1);
    }
    throw err;
  }

  const url = await app.getUrl().catch(() => `http://${host}:${port}`);
  bootstrapLogger.log(
    `API listening: ${url}${API_PREFIX_PATH} (dataDir=${process.env.APP_DATA_DIR ?? 'n/a'})`,
  );
}
void bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
