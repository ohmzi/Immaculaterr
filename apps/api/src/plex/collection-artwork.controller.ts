import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import type { Response } from 'express';
import { readFile } from 'node:fs/promises';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../db/prisma.service';
import {
  CollectionArtworkService,
  type CollectionArtworkMediaType,
  type CollectionArtworkTargetKind,
} from './collection-artwork.service';
import { DeleteArtworkOverrideDto } from './dto/collection-artwork.dto';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveMediaType(value: unknown): CollectionArtworkMediaType {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'movie' || normalized === 'tv') {
    return normalized;
  }
  throw new BadRequestException('mediaType must be "movie" or "tv"');
}

function resolveTargetKind(value: unknown): CollectionArtworkTargetKind {
  const normalized = asString(value).toLowerCase();
  if (
    normalized === 'immaculate_profile' ||
    normalized === 'watched_collection'
  ) {
    return normalized;
  }
  throw new BadRequestException(
    'targetKind must be "immaculate_profile" or "watched_collection"',
  );
}

function resolveTargetId(value: unknown): string {
  const targetId = asString(value);
  if (!targetId) throw new BadRequestException('targetId is required');
  return targetId;
}

@Controller('collection-artwork')
export class CollectionArtworkController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collectionArtwork: CollectionArtworkService,
  ) {}

  private async assertAdminSession(userId: string): Promise<void> {
    const adminUser = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!adminUser || adminUser.id !== userId) {
      throw new ForbiddenException(
        'Only the admin account can manage collection artwork',
      );
    }
  }

  @Get('managed-collections')
  async listManagedCollections(
    @Req() req: AuthenticatedRequest,
    @Query('plexUserId') plexUserIdRaw: string,
  ) {
    await this.assertAdminSession(req.user.id);

    const plexUserId = asString(plexUserIdRaw);
    if (!plexUserId) throw new BadRequestException('plexUserId is required');

    return await this.collectionArtwork.listManagedTargetsForUser({
      requestUserId: req.user.id,
      plexUserId,
    });
  }

  @Post('override')
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async uploadOverride(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    await this.assertAdminSession(req.user.id);

    const plexUserId = asString(body['plexUserId']);
    if (!plexUserId) throw new BadRequestException('plexUserId is required');

    const mediaType = resolveMediaType(body['mediaType']);
    const targetKind = resolveTargetKind(body['targetKind']);
    const targetId = resolveTargetId(body['targetId']);

    const file =
      (files ?? []).find((entry) => entry.fieldname === 'file') ??
      (files ?? [])[0] ??
      null;
    if (!file) throw new BadRequestException('file is required');

    const override = await this.collectionArtwork.saveOverride({
      plexUserId,
      mediaType,
      targetKind,
      targetId,
      file,
    });

    const applyResult = await this.collectionArtwork.applyOverrideNow({
      requestUserId: req.user.id,
      plexUserId,
      mediaType,
      targetKind,
      targetId,
    });

    return {
      ok: true as const,
      override,
      appliedNow: applyResult.appliedNow,
      ...(applyResult.warnings.length
        ? { warnings: applyResult.warnings }
        : {}),
    };
  }

  @Delete('override')
  async deleteOverride(
    @Req() req: AuthenticatedRequest,
    @Body() body: DeleteArtworkOverrideDto,
  ) {
    await this.assertAdminSession(req.user.id);

    const plexUserId = asString(body.plexUserId);
    if (!plexUserId) throw new BadRequestException('plexUserId is required');

    const mediaType = resolveMediaType(body.mediaType);
    const targetKind = resolveTargetKind(body.targetKind);
    const targetId = resolveTargetId(body.targetId);

    await this.collectionArtwork.deleteOverride({
      plexUserId,
      mediaType,
      targetKind,
      targetId,
    });

    return { ok: true as const };
  }

  @Get('override/preview')
  async getOverridePreview(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('plexUserId') plexUserIdRaw: string,
    @Query('mediaType') mediaTypeRaw: string,
    @Query('targetKind') targetKindRaw: string,
    @Query('targetId') targetIdRaw: string,
  ) {
    await this.assertAdminSession(req.user.id);

    const plexUserId = asString(plexUserIdRaw);
    if (!plexUserId) throw new BadRequestException('plexUserId is required');

    const mediaType = resolveMediaType(mediaTypeRaw);
    const targetKind = resolveTargetKind(targetKindRaw);
    const targetId = resolveTargetId(targetIdRaw);

    const preview = await this.collectionArtwork.getOverridePreview({
      plexUserId,
      mediaType,
      targetKind,
      targetId,
    });
    if (!preview) {
      throw new NotFoundException('Custom poster not found for this target');
    }

    const file = await readFile(preview.absolutePosterPath);
    res.setHeader(
      'Content-Type',
      preview.mimeType || 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    return res.status(200).send(file);
  }
}
