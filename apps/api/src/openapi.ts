import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { ensureBootstrapEnv } from './bootstrap-env';

async function generateOpenApi() {
  await ensureBootstrapEnv();
  // Avoid starting cron jobs during spec generation.
  process.env.SCHEDULER_ENABLED = 'false';
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Tautulli Curated Plex API')
    .setDescription('Local API for the Tautulli Curated Plex webapp.')
    .setVersion('0.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Default: write into apps/api/openapi.json
  const defaultOutPath = join(__dirname, '..', 'openapi.json');
  const outPath = process.env.OPENAPI_OUTPUT?.trim() || defaultOutPath;

  await writeFile(outPath, JSON.stringify(document, null, 2), 'utf8');
  await app.close();
}

generateOpenApi().catch((err) => {
  console.error(err);
  process.exit(1);
});
