import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SeerrController } from './seerr.controller';
import { SeerrService } from './seerr.service';

@Module({
  imports: [SettingsModule],
  controllers: [SeerrController],
  providers: [SeerrService],
  exports: [SeerrService],
})
export class SeerrModule {}
