import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { OpenAiModule } from '../openai/openai.module';
import { OverseerrModule } from '../overseerr/overseerr.module';
import { PlexModule } from '../plex/plex.module';
import { RadarrModule } from '../radarr/radarr.module';
import { SettingsModule } from '../settings/settings.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { IntegrationsController } from './integrations.controller';

@Module({
  imports: [
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
})
export class IntegrationsModule {}


