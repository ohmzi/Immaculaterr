import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
  ObservatoryWatchedDecisionsDto,
  ObservatoryApplyDto,
} from './dto/observatory.dto';

type ListMode = 'pendingApproval' | 'review';
type CollectionKind = 'recentlyWatched' | 'changeOfTaste';

@Controller('observatory/watched')
@ApiTags('observatory')
export class WatchedObservatoryController {
  constructor(
    private readonly observatory: ObservatoryService,
    private readonly applyRunner: ObservatoryApplyRunner,
  ) {}

  @Get('movies')
  async listMovies(
    @Req() req: AuthenticatedRequest,
    @Query('librarySectionKey') librarySectionKeyRaw: string,
    @Query('mode') modeRaw: string,
    @Query('collectionKind') collectionKindRaw: string,
  ) {
    const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
    const mode = (String(modeRaw ?? '').trim() as ListMode) || 'review';
    const collectionKind =
      (String(collectionKindRaw ?? '').trim() as CollectionKind) || '';
    if (!librarySectionKey)
      throw new BadRequestException('librarySectionKey is required');
    if (mode !== 'pendingApproval' && mode !== 'review')
      throw new BadRequestException('mode must be pendingApproval|review');
    if (
      collectionKind !== 'recentlyWatched' &&
      collectionKind !== 'changeOfTaste'
    )
      throw new BadRequestException(
        'collectionKind must be recentlyWatched|changeOfTaste',
      );

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
    const collectionKind =
      (String(collectionKindRaw ?? '').trim() as CollectionKind) || '';
    if (!librarySectionKey)
      throw new BadRequestException('librarySectionKey is required');
    if (mode !== 'pendingApproval' && mode !== 'review')
      throw new BadRequestException('mode must be pendingApproval|review');
    if (
      collectionKind !== 'recentlyWatched' &&
      collectionKind !== 'changeOfTaste'
    )
      throw new BadRequestException(
        'collectionKind must be recentlyWatched|changeOfTaste',
      );

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
    @Body() body: ObservatoryWatchedDecisionsDto,
  ) {
    const librarySectionKey =
      typeof body.librarySectionKey === 'string'
        ? body.librarySectionKey.trim()
        : '';
    const mediaType =
      typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
    const collectionKind =
      typeof body.collectionKind === 'string' ? body.collectionKind.trim() : '';
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];

    if (!librarySectionKey)
      throw new BadRequestException('librarySectionKey is required');
    if (mediaType !== 'movie' && mediaType !== 'tv')
      throw new BadRequestException('mediaType must be movie|tv');
    if (
      collectionKind !== 'recentlyWatched' &&
      collectionKind !== 'changeOfTaste'
    )
      throw new BadRequestException(
        'collectionKind must be recentlyWatched|changeOfTaste',
      );

    return await this.observatory.recordWatchedDecisions({
      userId: req.user.id,
      librarySectionKey,
      mediaType,
      collectionKind: collectionKind as CollectionKind,
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

    // Background-started for the same reason as the Immaculate Taste apply:
    // the Plex collection rebuild is far too slow to hold an HTTP request
    // open across a reverse proxy. The client polls `apply/:applyId`.
    const record = this.applyRunner.start({
      userId: req.user.id,
      key: this.applyRunner.buildKey({
        userId: req.user.id,
        scope: 'watched',
        mediaType,
        librarySectionKey,
      }),
      run: () =>
        this.observatory.applyWatched({
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
}
