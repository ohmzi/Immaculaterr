import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { DbModule } from '../db/db.module';
import { RadarrModule } from '../radarr/radarr.module';
import { SettingsModule } from '../settings/settings.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { ArrInstanceController } from './arr-instance.controller';
import { ArrInstanceService } from './arr-instance.service';

@Module({
  imports: [DbModule, SettingsModule, CryptoModule, RadarrModule, SonarrModule],
  controllers: [ArrInstanceController],
  providers: [ArrInstanceService],
  exports: [ArrInstanceService],
})
export class ArrInstanceModule {}
