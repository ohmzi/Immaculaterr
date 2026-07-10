import { Module } from '@nestjs/common';
import { TautulliService } from './tautulli.service';

@Module({
  providers: [TautulliService],
  exports: [TautulliService],
})
export class TautulliModule {}
