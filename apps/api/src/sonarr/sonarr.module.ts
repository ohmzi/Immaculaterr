import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SonarrController } from './sonarr.controller';
import { SonarrService } from './sonarr.service';

@Module({
  imports: [SettingsModule],
  controllers: [SonarrController],
  providers: [SonarrService],
  exports: [SonarrService],
})
export class SonarrModule {}
