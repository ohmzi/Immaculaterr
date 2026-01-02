import { Module } from '@nestjs/common';
import { OpenAiController } from './openai.controller';
import { OpenAiService } from './openai.service';

@Module({
  controllers: [OpenAiController],
  providers: [OpenAiService],
  exports: [OpenAiService],
})
export class OpenAiModule {}
