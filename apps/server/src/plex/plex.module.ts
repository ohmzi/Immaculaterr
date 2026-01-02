import { Module } from '@nestjs/common';
import { PlexController } from './plex.controller';
import { PlexService } from './plex.service';

@Module({
  controllers: [PlexController],
  providers: [PlexService],
})
export class PlexModule {}


