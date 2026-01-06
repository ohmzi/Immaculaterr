import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { WatchedMovieRecommendationsService } from './watched-movie-recommendations.service';

@Module({
  imports: [DbModule],
  providers: [WatchedMovieRecommendationsService],
  exports: [WatchedMovieRecommendationsService],
})
export class WatchedMovieRecommendationsModule {}


