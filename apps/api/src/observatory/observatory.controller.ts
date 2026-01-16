import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ObservatoryService } from './observatory.service';

type ListMode = 'pendingApproval' | 'review';

@Controller('observatory/immaculate-taste')
@ApiTags('observatory')
export class ObservatoryController {
  constructor(private readonly observatory: ObservatoryService) {}

  @Get('movies')
  async listMovies(
    @Req() req: AuthenticatedRequest,
    @Query('librarySectionKey') librarySectionKeyRaw: string,
    @Query('mode') modeRaw: string,
  ) {
    const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
    const mode = (String(modeRaw ?? '').trim() as ListMode) || 'review';
    if (!librarySectionKey) throw new BadRequestException('librarySectionKey is required');
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
    if (!librarySectionKey) throw new BadRequestException('librarySectionKey is required');
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
    @Body()
    body: {
      librarySectionKey?: unknown;
      mediaType?: unknown;
      decisions?: unknown;
    },
  ) {
    const librarySectionKey =
      typeof body.librarySectionKey === 'string' ? body.librarySectionKey.trim() : '';
    const mediaType = typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];

    if (!librarySectionKey) throw new BadRequestException('librarySectionKey is required');
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
  async apply(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      librarySectionKey?: unknown;
      mediaType?: unknown;
    },
  ) {
    const librarySectionKey =
      typeof body.librarySectionKey === 'string' ? body.librarySectionKey.trim() : '';
    const mediaType = typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
    if (!librarySectionKey) throw new BadRequestException('librarySectionKey is required');
    if (mediaType !== 'movie' && mediaType !== 'tv')
      throw new BadRequestException('mediaType must be movie|tv');

    return await this.observatory.apply({
      userId: req.user.id,
      librarySectionKey,
      mediaType,
    });
  }

  @Delete('rejected/reset')
  async resetRejected(@Req() req: AuthenticatedRequest) {
    return await this.observatory.resetRejectedSuggestions({ userId: req.user.id });
  }

  @Get('rejected')
  async listRejected(@Req() req: AuthenticatedRequest) {
    return await this.observatory.listRejectedSuggestions({ userId: req.user.id });
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

