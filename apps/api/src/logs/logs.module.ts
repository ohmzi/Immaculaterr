import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LogsRetentionService } from './logs-retention.service';

@Module({
  controllers: [LogsController],
  providers: [LogsRetentionService],
})
export class LogsModule {}
