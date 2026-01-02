import { Module } from '@nestjs/common';
import { GoogleController } from './google.controller';
import { GoogleService } from './google.service';

@Module({
  controllers: [GoogleController],
  providers: [GoogleService],
})
export class GoogleModule {}


