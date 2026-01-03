import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { listServerLogs } from './server-logs.store';

@Controller('logs')
@ApiTags('logs')
export class LogsController {
  @Get()
  getLogs(@Query('afterId') afterIdRaw?: string, @Query('limit') limitRaw?: string) {
    const afterId = afterIdRaw ? Number.parseInt(afterIdRaw, 10) : undefined;
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const data = listServerLogs({
      afterId: Number.isFinite(afterId) ? afterId : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return { ok: true, ...data };
  }
}


