import { Module } from '@nestjs/common';
import { OverseerrController } from './overseerr.controller';
import { OverseerrService } from './overseerr.service';

@Module({
  controllers: [OverseerrController],
  providers: [OverseerrService],
  exports: [OverseerrService],
})
export class OverseerrModule {}


