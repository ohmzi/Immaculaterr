import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ObservatoryService } from './observatory.service';

type ListMode = 'pendingApproval' | 'review';
type CollectionKind = 'recentlyWatched' | 'changeOfTaste';

@Controller('observatory/watched')
@ApiTags('observatory')
export class WatchedObservatoryController {
  constructor(private readonly observatory: ObservatoryService) {}

  @Get('movies')
  async listMovies(
    @Req() req: AuthenticatedRequest,
    @Query('librarySectionKey') librarySectionKeyRaw: string,
    @Query('mode') modeRaw: string,
    @Query('collectionKind') collectionKindRaw: string,
  ) {
    const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
    const mode = (String(modeRaw ?? '').trim() as ListMode) || 'review';
    const collectionKind = (String(collectionKindRaw ?? '').trim() as CollectionKind) || '';
    if (!librarySectionKey) throw new BadRequestException('librarySectionKey is required');
    if (mode !== 'pendingApproval' && mode !== 'review')
      throw new BadRequestException('mode must be pendingApproval|review');
    if (collectionKind !== 'recentlyWatched' && collectionKind !== 'changeOfTaste')
      throw new BadRequestException('collectionKind must be recentlyWatched|changeOfTaste');

    return await this.observatory.listWatchedMovies({
      userId: req.user.id,
      librarySectionKey,
      mode,
      collectionKind,
    });
  }

  @Get('tv')
  async listTv(
    @Req() req: AuthenticatedRequest,
    @Query('librarySectionKey') librarySectionKeyRaw: string,
    @Query('mode') modeRaw: string,
    @Query('collectionKind') collectionKindRaw: string,
  ) {
    const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
    const mode = (String(modeRaw ?? '').trim() as ListMode) || 'review';
    const collectionKind = (String(collectionKindRaw ?? '').trim() as CollectionKind) || '';
    if (!librarySectionKey) throw new BadRequestException('librarySectionKey is required');
    if (mode !== 'pendingApproval' && mode !== 'review')
      throw new BadRequestException('mode must be pendingApproval|review');
    if (collectionKind !== 'recentlyWatched' && collectionKind !== 'changeOfTaste')
      throw new BadRequestException('collectionKind must be recentlyWatched|changeOfTaste');

    return await this.observatory.listWatchedTv({
      userId: req.user.id,
      librarySectionKey,
      mode,
      collectionKind,
    });
  }

  @Post('decisions')
  async recordDecisions(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      librarySectionKey?: unknown;
      mediaType?: unknown;
      collectionKind?: unknown;
      decisions?: unknown;
    },
  ) {
    const librarySectionKey =
      typeof body.librarySectionKey === 'string' ? body.librarySectionKey.trim() : '';
    const mediaType = typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
    const collectionKind =
      typeof body.collectionKind === 'string' ? body.collectionKind.trim() : '';
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];

    if (!librarySectionKey) throw new BadRequestException('librarySectionKey is required');
    if (mediaType !== 'movie' && mediaType !== 'tv')
      throw new BadRequestException('mediaType must be movie|tv');
    if (collectionKind !== 'recentlyWatched' && collectionKind !== 'changeOfTaste')
      throw new BadRequestException('collectionKind must be recentlyWatched|changeOfTaste');

    return await this.observatory.recordWatchedDecisions({
      userId: req.user.id,
      librarySectionKey,
      mediaType,
      collectionKind: collectionKind as CollectionKind,
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

    return await this.observatory.applyWatched({
      userId: req.user.id,
      librarySectionKey,
      mediaType,
    });
  }
}

