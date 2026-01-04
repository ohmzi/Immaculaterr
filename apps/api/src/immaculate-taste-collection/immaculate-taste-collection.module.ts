import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ImmaculateTasteCollectionService } from './immaculate-taste-collection.service';

@Module({
  imports: [DbModule],
  providers: [ImmaculateTasteCollectionService],
  exports: [ImmaculateTasteCollectionService],
})
export class ImmaculateTasteCollectionModule {}


