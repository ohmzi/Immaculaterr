import { Module } from '@nestjs/common';
import { RadarrController } from './radarr.controller';
import { RadarrService } from './radarr.service';

@Module({
  controllers: [RadarrController],
  providers: [RadarrService],
  exports: [RadarrService],
})
export class RadarrModule {}
