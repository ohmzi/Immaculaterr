import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlexModule } from './plex/plex.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { RadarrModule } from './radarr/radarr.module';
import { SonarrModule } from './sonarr/sonarr.module';
import { GoogleModule } from './google/google.module';
import { TmdbModule } from './tmdb/tmdb.module';
import { OpenAiModule } from './openai/openai.module';
import { OverseerrModule } from './overseerr/overseerr.module';
import { CryptoModule } from './crypto/crypto.module';
import { SettingsModule } from './settings/settings.module';
import { JobsModule } from './jobs/jobs.module';
import { AuthModule } from './auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { IntegrationsModule } from './integrations/integrations.module';
import { CollectionsModule } from './collections/collections.module';
import { LogsModule } from './logs/logs.module';

const webDistPath = join(__dirname, '..', '..', 'web', 'dist');
const staticImports = existsSync(webDistPath)
  ? [
      ServeStaticModule.forRoot({
        rootPath: webDistPath,
        // Keep API routes on the Nest side.
        exclude: ['/api*'],
      }),
    ]
  : [];

@Module({
  imports: [
    ...staticImports,
    CryptoModule,
    AuthModule,
    SettingsModule,
    IntegrationsModule,
    CollectionsModule,
    LogsModule,
    JobsModule,
    PlexModule,
    WebhooksModule,
    RadarrModule,
    SonarrModule,
    GoogleModule,
    TmdbModule,
    OpenAiModule,
    OverseerrModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useExisting: AuthGuard,
    },
  ],
})
export class AppModule {}
