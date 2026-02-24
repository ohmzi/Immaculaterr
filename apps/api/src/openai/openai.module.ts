import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { OpenAiController } from './openai.controller';
import { OpenAiService } from './openai.service';

@Module({
  imports: [SettingsModule],
  controllers: [OpenAiController],
  providers: [OpenAiService],
  exports: [OpenAiService],
})
export class OpenAiModule {}
