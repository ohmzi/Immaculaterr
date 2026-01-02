import { Module } from '@nestjs/common';
import { SonarrController } from './sonarr.controller';
import { SonarrService } from './sonarr.service';

@Module({
  controllers: [SonarrController],
  providers: [SonarrService],
})
export class SonarrModule {}


