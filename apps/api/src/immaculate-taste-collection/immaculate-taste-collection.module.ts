import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ImmaculateTasteCollectionService } from './immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from './immaculate-taste-show-collection.service';

@Module({
  imports: [DbModule],
  providers: [ImmaculateTasteCollectionService, ImmaculateTasteShowCollectionService],
  exports: [ImmaculateTasteCollectionService, ImmaculateTasteShowCollectionService],
})
export class ImmaculateTasteCollectionModule {}
