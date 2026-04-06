import { Module, forwardRef } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { SettingsModule } from '../settings/settings.module';
import { PlexModule } from '../plex/plex.module';
import { WatchedMovieRecommendationsModule } from '../watched-movie-recommendations/watched-movie-recommendations.module';
import { ImmaculateTasteCollectionModule } from '../immaculate-taste-collection/immaculate-taste-collection.module';
import { JobsModule } from '../jobs/jobs.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [
    DbModule,
    TmdbModule,
    RecommendationsModule,
    SettingsModule,
    PlexModule,
    WatchedMovieRecommendationsModule,
    ImmaculateTasteCollectionModule,
    forwardRef(() => JobsModule),
  ],
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {
  readonly moduleId = 'ImportModule';
}
