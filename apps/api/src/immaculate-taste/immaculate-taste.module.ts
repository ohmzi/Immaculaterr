import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ImmaculateTasteService } from './immaculate-taste.service';

@Module({
  imports: [DbModule],
  providers: [ImmaculateTasteService],
  exports: [ImmaculateTasteService],
})
export class ImmaculateTasteModule {}


