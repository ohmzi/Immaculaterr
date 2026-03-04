import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { PlexModule } from '../plex/plex.module';
import { SettingsModule } from '../settings/settings.module';
import { ImmaculateTasteProfileController } from './immaculate-taste-profile.controller';
import { ImmaculateTasteProfileService } from './immaculate-taste-profile.service';

@Module({
  imports: [DbModule, SettingsModule, PlexModule],
  controllers: [ImmaculateTasteProfileController],
  providers: [ImmaculateTasteProfileService],
  exports: [ImmaculateTasteProfileService],
})
export class ImmaculateTasteProfileModule {}
