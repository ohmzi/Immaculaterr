import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { OverseerrController } from './overseerr.controller';
import { OverseerrService } from './overseerr.service';

@Module({
  imports: [SettingsModule],
  controllers: [OverseerrController],
  providers: [OverseerrService],
  exports: [OverseerrService],
})
export class OverseerrModule {}
