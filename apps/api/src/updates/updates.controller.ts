import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { UpdatesResponseDto } from './updates.dto';
import { UpdatesService } from './updates.service';

@Controller('updates')
@ApiTags('updates')
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: UpdatesResponseDto })
  async getUpdates() {
    return await this.updates.getUpdates();
  }
}

