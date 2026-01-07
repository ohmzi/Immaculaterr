import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppService } from './app.service';
import { HealthResponseDto } from './app.dto';
import { Public } from './auth/public.decorator';

@Controller()
@ApiTags('app')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @Public()
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('ready')
  @Public()
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ready',
        time: '2026-01-02T00:00:00.000Z',
        checks: { db: { ok: true }, dataDir: { ok: true } },
      },
    },
  })
  async getReady(@Res({ passthrough: true }) res: Response) {
    const readiness = await this.appService.getReadiness();
    if (readiness.status !== 'ready') res.status(503);
    return readiness;
  }
}
