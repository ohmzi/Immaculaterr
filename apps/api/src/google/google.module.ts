import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';

@Module({
  imports: [SettingsModule],
  controllers: [GoogleController],
  providers: [GoogleService],
  exports: [GoogleService],
})
export class GoogleModule {}
