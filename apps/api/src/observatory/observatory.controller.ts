import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Delete,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ObservatoryService } from './observatory.service';
import {
  ObservatoryApplyRunner,
  serializeApplyRecord,
} from './observatory-apply.runner';
import {
  ObservatoryDecisionsDto,
  ObservatoryApplyDto,
} from './dto/observatory.dto';

type ListMode = 'pendingApproval' | 'review';

@Controller('observatory/immaculate-taste')
@ApiTags('observatory')
export class ObservatoryController {
  constructor(
    private readonly observatory: ObservatoryService,
    private readonly applyRunner: ObservatoryApplyRunner,
  ) {}

  @Get('movies')
  async listMovies(
    @Req() req: AuthenticatedRequest,
    @Query('librarySectionKey') librarySectionKeyRaw: string,
    @Query('mode') modeRaw: string,
  ) {
    const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
    const mode = (String(modeRaw ?? '').trim() as ListMode) || 'review';
    if (!librarySectionKey)
      throw new BadRequestException('librarySectionKey is required');
    if (mode !== 'pendingApproval' && mode !== 'review')
      throw new BadRequestException('mode must be pendingApproval|review');
    return await this.observatory.listMovies({
      userId: req.user.id,
      librarySectionKey,
      mode,
    });
  }

  @Get('tv')
  async listTv(
    @Req() req: AuthenticatedRequest,
    @Query('librarySectionKey') librarySectionKeyRaw: string,
    @Query('mode') modeRaw: string,
  ) {
    const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
    const mode = (String(modeRaw ?? '').trim() as ListMode) || 'review';
    if (!librarySectionKey)
      throw new BadRequestException('librarySectionKey is required');
    if (mode !== 'pendingApproval' && mode !== 'review')
      throw new BadRequestException('mode must be pendingApproval|review');
    return await this.observatory.listTv({
      userId: req.user.id,
      librarySectionKey,
      mode,
    });
  }

  @Post('decisions')
  async recordDecisions(
    @Req() req: AuthenticatedRequest,
    @Body() body: ObservatoryDecisionsDto,
  ) {
    const librarySectionKey =
      typeof body.librarySectionKey === 'string'
        ? body.librarySectionKey.trim()
        : '';
    const mediaType =
      typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];

    if (!librarySectionKey)
      throw new BadRequestException('librarySectionKey is required');
    if (mediaType !== 'movie' && mediaType !== 'tv')
      throw new BadRequestException('mediaType must be movie|tv');

    return await this.observatory.recordDecisions({
      userId: req.user.id,
      librarySectionKey,
      mediaType,
      decisions,
    });
  }

  @Post('apply')
  // 202: the work is accepted and started, not finished when this returns.
  @HttpCode(HttpStatus.ACCEPTED)
  apply(@Req() req: AuthenticatedRequest, @Body() body: ObservatoryApplyDto) {
    const librarySectionKey =
      typeof body.librarySectionKey === 'string'
        ? body.librarySectionKey.trim()
        : '';
    const mediaType =
      typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
    if (!librarySectionKey)
      throw new BadRequestException('librarySectionKey is required');
    if (mediaType !== 'movie' && mediaType !== 'tv')
      throw new BadRequestException('mediaType must be movie|tv');

    // Started in the background rather than awaited: a full Plex collection
    // rebuild routinely outlives a reverse proxy's origin timeout, which
    // surfaced to the user as a gateway error even though the sync itself
    // was fine. The client polls `apply/:applyId` for the outcome.
    const record = this.applyRunner.start({
      userId: req.user.id,
      key: this.applyRunner.buildKey({
        userId: req.user.id,
        scope: 'immaculate',
        mediaType,
        librarySectionKey,
      }),
      run: () =>
        this.observatory.apply({
          userId: req.user.id,
          librarySectionKey,
          mediaType,
        }),
    });
    return serializeApplyRecord(record);
  }

  @Get('apply/:applyId')
  applyStatus(
    @Req() req: AuthenticatedRequest,
    @Param('applyId') applyIdRaw: string,
  ) {
    const applyId = String(applyIdRaw ?? '').trim();
    if (!applyId) throw new BadRequestException('applyId is required');
    return serializeApplyRecord(
      this.applyRunner.get({ userId: req.user.id, id: applyId }),
    );
  }

  @Delete('rejected/reset')
  async resetRejected(@Req() req: AuthenticatedRequest) {
    return await this.observatory.resetRejectedSuggestions({
      userId: req.user.id,
    });
  }

  @Get('rejected')
  async listRejected(@Req() req: AuthenticatedRequest) {
    return await this.observatory.listRejectedSuggestions({
      userId: req.user.id,
    });
  }

  @Delete('rejected/:id')
  async deleteRejected(
    @Req() req: AuthenticatedRequest,
    @Param('id') idRaw: string,
  ) {
    const id = String(idRaw ?? '').trim();
    if (!id) throw new BadRequestException('id is required');
    return await this.observatory.deleteRejectedSuggestion({
      userId: req.user.id,
      id,
    });
  }
}
