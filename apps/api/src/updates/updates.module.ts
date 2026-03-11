import { Module } from '@nestjs/common';
import { UpdatesController } from './updates.controller';
import { UpdatesService } from './updates.service';

@Module({
  controllers: [UpdatesController],
  providers: [UpdatesService],
})
export class UpdatesModule {}
