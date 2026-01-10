import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { PlexModule } from '../plex/plex.module';
import { WatchedCollectionsRefresherService } from './watched-collections-refresher.service';

@Module({
  imports: [DbModule, PlexModule],
  providers: [WatchedCollectionsRefresherService],
  exports: [WatchedCollectionsRefresherService],
})
export class WatchedMovieRecommendationsModule {}


