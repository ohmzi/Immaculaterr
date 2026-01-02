import { Module } from '@nestjs/common';
import { PlexController } from './plex.controller';
import { PlexService } from './plex.service';
import { PlexServerService } from './plex-server.service';

@Module({
  controllers: [PlexController],
  providers: [PlexService, PlexServerService],
  exports: [PlexService, PlexServerService],
})
export class PlexModule {}


