import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { GoogleModule } from '../google/google.module';
import { OpenAiModule } from '../openai/openai.module';
import { OverseerrModule } from '../overseerr/overseerr.module';
import { PlexModule } from '../plex/plex.module';
import { RadarrModule } from '../radarr/radarr.module';
import { SettingsModule } from '../settings/settings.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsConnectivityMonitorService } from './integrations-connectivity-monitor.service';

@Module({
  imports: [
    DbModule,
    SettingsModule,
    PlexModule,
    RadarrModule,
    SonarrModule,
    TmdbModule,
    GoogleModule,
    OpenAiModule,
    OverseerrModule,
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsConnectivityMonitorService],
})
export class IntegrationsModule {}
