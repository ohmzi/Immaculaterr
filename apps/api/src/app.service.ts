import { Injectable } from '@nestjs/common';
import type { HealthResponseDto } from './app.dto';

@Injectable()
export class AppService {
  getHealth(): HealthResponseDto {
    return {
      status: 'ok' as const,
      time: new Date().toISOString(),
    };
  }
}
