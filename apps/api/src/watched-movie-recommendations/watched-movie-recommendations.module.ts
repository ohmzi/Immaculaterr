import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { WatchedMovieRecommendationsService } from './watched-movie-recommendations.service';
import { WatchedShowRecommendationsService } from './watched-show-recommendations.service';

@Module({
  imports: [DbModule, TmdbModule],
  providers: [WatchedMovieRecommendationsService, WatchedShowRecommendationsService],
  exports: [WatchedMovieRecommendationsService, WatchedShowRecommendationsService],
})
export class WatchedMovieRecommendationsModule {}


