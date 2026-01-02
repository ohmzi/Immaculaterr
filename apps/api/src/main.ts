import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ensureBootstrapEnv } from './bootstrap-env';

async function bootstrap() {
  await ensureBootstrapEnv();
  const bootstrapLogger = new Logger('Bootstrap');

  process.on('unhandledRejection', (reason) => {
    bootstrapLogger.error(`Unhandled rejection: ${String(reason)}`);
  });
  process.on('uncaughtException', (err) => {
    bootstrapLogger.error(`Uncaught exception: ${err?.stack ?? String(err)}`);
    process.exit(1);
  });

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  // Keep the API surface separate from the UI routes we’ll serve later.
  app.setGlobalPrefix('api');

  // Dev-friendly defaults (Vite proxy, etc.)
  app.enableCors({
    origin: true,
    credentials: true,
  });

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
        else if (ms >= 1500) httpLogger.warn(`SLOW ${msg}`);
      });
      next();
    });
  }

  const swaggerEnabled =
    process.env.SWAGGER_ENABLED === 'true' ||
    process.env.NODE_ENV !== 'production';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Tautulli Curated Plex API')
      .setDescription('Local API for the Tautulli Curated Plex webapp.')
      .setVersion('0.0.0')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    // Note: Swagger routes are not affected by Nest's globalPrefix; include it explicitly.
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // Default away from 3000 (commonly taken on dev machines).
  const port = Number.parseInt(process.env.PORT ?? '3210', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  try {
    await app.listen(port, host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EADDRINUSE') {
      bootstrapLogger.error(
        `Port ${port} is already in use. Stop the other process or set PORT to a free port.`,
      );
      bootstrapLogger.error(`Example: PORT=3211 npm run dev:api`);
      process.exit(1);
    }
    throw err;
  }

  const url = await app.getUrl().catch(() => `http://${host}:${port}`);
  bootstrapLogger.log(
    `API listening: ${url}/api (dataDir=${process.env.APP_DATA_DIR ?? 'n/a'})`,
  );
}
void bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
