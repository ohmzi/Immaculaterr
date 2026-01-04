import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { OpenAiModule } from '../openai/openai.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [GoogleModule, OpenAiModule, TmdbModule],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}


