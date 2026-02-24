import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { RadarrController } from './radarr.controller';
import { RadarrService } from './radarr.service';

@Module({
  imports: [SettingsModule],
  controllers: [RadarrController],
  providers: [RadarrService],
  exports: [RadarrService],
})
export class RadarrModule {}
