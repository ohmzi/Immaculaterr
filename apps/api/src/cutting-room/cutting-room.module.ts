import { Module, forwardRef } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { SettingsModule } from '../settings/settings.module';
import { PlexModule } from '../plex/plex.module';
import { RadarrModule } from '../radarr/radarr.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { SeerrModule } from '../seerr/seerr.module';
import { TautulliModule } from '../tautulli/tautulli.module';
import { ArrInstanceModule } from '../arr-instances/arr-instance.module';
import { JobsModule } from '../jobs/jobs.module';
import { CuttingRoomController } from './cutting-room.controller';
import { CuttingRoomService } from './cutting-room.service';
import { CuttingRoomAnalysisService } from './cutting-room-analysis.service';
import { CuttingRoomPruneService } from './cutting-room-prune.service';
import { CuttingRoomRulesService } from './cutting-room-rules.service';
import { CuttingRoomWantedService } from './cutting-room-wanted.service';

@Module({
  imports: [
    DbModule,
    SettingsModule,
    PlexModule,
    RadarrModule,
    SonarrModule,
    SeerrModule,
    TautulliModule,
    ArrInstanceModule,
    forwardRef(() => JobsModule),
  ],
  controllers: [CuttingRoomController],
  providers: [
    CuttingRoomService,
    CuttingRoomAnalysisService,
    CuttingRoomPruneService,
    CuttingRoomRulesService,
    CuttingRoomWantedService,
  ],
  exports: [
    CuttingRoomService,
    CuttingRoomAnalysisService,
    CuttingRoomPruneService,
    CuttingRoomRulesService,
    CuttingRoomWantedService,
  ],
})
export class CuttingRoomModule {}
