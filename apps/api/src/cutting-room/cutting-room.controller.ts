import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { JobsService } from '../jobs/jobs.service';
import type { JsonObject } from '../jobs/jobs.types';
import { CuttingRoomRulesService } from './cutting-room-rules.service';
import { CuttingRoomService, type CandidateSort } from './cutting-room.service';
import { CuttingRoomWantedService } from './cutting-room-wanted.service';
import {
  AutoSelectDto,
  DuplicateCleanupDto,
  LargeFilesReplaceDto,
  PatchSelectionDto,
  StartAnalyzeDto,
  StartPruneDto,
  UpdateCuttingRoomRulesDto,
  WantedPruneDto,
} from './dto/cutting-room.dto';

function parseIntParam(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

@Controller('cutting-room')
@ApiTags('cutting-room')
export class CuttingRoomController {
  constructor(
    private readonly cuttingRoom: CuttingRoomService,
    private readonly rules: CuttingRoomRulesService,
    private readonly wanted: CuttingRoomWantedService,
    private readonly jobsService: JobsService,
  ) {}

  // ---- Rules & environment -------------------------------------------------

  @Get('rules')
  async getRules(@CurrentUser() user: AuthUser) {
    const [rules, prereqs] = await Promise.all([
      this.rules.getRules(user.id),
      this.cuttingRoom.getPrereqs(user.id),
    ]);
    return { rules, prereqs };
  }

  @Put('rules')
  async putRules(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateCuttingRoomRulesDto,
  ) {
    const rules = await this.rules.updateRules(user.id, body.rules ?? {});
    return { rules };
  }

  @Get('libraries')
  async listLibraries(
    @CurrentUser() user: AuthUser,
    @Query('mediaType') mediaTypeRaw?: string,
  ) {
    const mediaType = mediaTypeRaw === 'show' ? 'show' : 'movie';
    return {
      libraries: await this.cuttingRoom.listPlexLibraries(user.id, mediaType),
    };
  }

  @Get('diskspace')
  async diskspace(
    @CurrentUser() user: AuthUser,
    @Query('type') typeRaw?: string,
  ) {
    const type = typeRaw === 'sonarr' ? 'sonarr' : 'radarr';
    const [disks, recycleBin] = await Promise.all([
      this.cuttingRoom.getDiskSpace(user.id, type),
      this.cuttingRoom.getRecycleBinInfo(user.id, type),
    ]);
    return { disks, recycleBin };
  }

  // ---- Analyze / snapshots ---------------------------------------------------

  @Post('analyze')
  async analyze(@CurrentUser() user: AuthUser, @Body() body: StartAnalyzeDto) {
    const snapshotId = await this.cuttingRoom.createSnapshot({
      userId: user.id,
      mediaType: body.mediaType,
      sectionKeys: body.sectionKeys ?? [],
      instanceIds: body.instanceIds ?? [],
      rulesOverride: body.rulesOverride,
    });
    const run = await this.jobsService.runJob({
      jobId: 'cuttingRoomAnalyze',
      trigger: 'manual',
      dryRun: false,
      userId: user.id,
      input: { snapshotId },
    });
    return { snapshotId, run };
  }

  @Get('snapshots')
  async listSnapshots(
    @CurrentUser() user: AuthUser,
    @Query('take') takeRaw?: string,
  ) {
    return {
      snapshots: await this.cuttingRoom.listSnapshots(
        user.id,
        parseIntParam(takeRaw, 10, 50),
      ),
    };
  }

  @Get('snapshots/:id')
  async getSnapshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { snapshot: await this.cuttingRoom.getSnapshot(user.id, id) };
  }

  @Get('snapshots/:id/candidates')
  async listCandidates(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('take') takeRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('sort') sortRaw?: string,
    @Query('dir') dirRaw?: string,
    @Query('maxTier') maxTierRaw?: string,
    @Query('minScore') minScoreRaw?: string,
    @Query('rootFolder') rootFolder?: string,
    @Query('watchStatus') watchStatus?: string,
    @Query('search') search?: string,
    @Query('selectedOnly') selectedOnlyRaw?: string,
  ) {
    const sort: CandidateSort = [
      'score',
      'size',
      'scorePerGb',
      'addedAt',
    ].includes(sortRaw ?? '')
      ? (sortRaw as CandidateSort)
      : 'score';
    return await this.cuttingRoom.listCandidates({
      userId: user.id,
      snapshotId: id,
      take: parseIntParam(takeRaw, 50, 200),
      skip: parseIntParam(skipRaw, 0, 1_000_000),
      sort,
      dir: dirRaw === 'asc' ? 'asc' : 'desc',
      maxTier: maxTierRaw
        ? parseIntParam(maxTierRaw, 0, 4) || undefined
        : undefined,
      minScore: minScoreRaw
        ? parseIntParam(minScoreRaw, 0, 1000) || undefined
        : undefined,
      rootFolder: rootFolder || undefined,
      watchStatus: watchStatus || undefined,
      search: search || undefined,
      selectedOnly: selectedOnlyRaw === 'true',
    });
  }

  @Get('snapshots/:id/rootfolders')
  async listSnapshotRootFolders(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return { rootFolders: await this.cuttingRoom.listRootFolders(user.id, id) };
  }

  // ---- Selection ---------------------------------------------------------------

  @Post('snapshots/:id/selection/auto')
  async autoSelect(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AutoSelectDto,
  ) {
    return await this.cuttingRoom.autoSelect({
      userId: user.id,
      snapshotId: id,
      targetBytes: body.targetBytes,
      maxTier: body.maxTier,
      minScore: body.minScore,
      rootFolder: body.rootFolder,
    });
  }

  @Patch('snapshots/:id/candidates')
  async patchSelection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PatchSelectionDto,
  ) {
    return await this.cuttingRoom.patchSelection({
      userId: user.id,
      snapshotId: id,
      ids: body.ids,
      all: body.all,
      selected: body.selected,
      maxTier: body.maxTier,
      minScore: body.minScore,
      rootFolder: body.rootFolder,
    });
  }

  // ---- Prune ---------------------------------------------------------------------

  @Post('snapshots/:id/prune')
  async prune(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: StartPruneDto,
  ) {
    const dryRun = body.dryRun === true;
    if (!dryRun) {
      await this.cuttingRoom.validatePruneRequest({
        userId: user.id,
        snapshotId: id,
        confirmation: body.confirmation ?? '',
      });
    }
    if (!body.dryRun) this.cuttingRoom.invalidateFanoutCache(user.id);
    const run = await this.jobsService.runJob({
      jobId: 'cuttingRoomPrune',
      trigger: 'manual',
      dryRun,
      userId: user.id,
      input: {
        snapshotId: id,
        ...(body.waveSize ? { waveSize: body.waveSize } : {}),
        removeEntry: body.removeEntry === true,
        addImportExclusion: body.addImportExclusion === true,
      },
    });
    return { run };
  }

  @Post('snapshots/:id/stop')
  async stop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return await this.cuttingRoom.requestStop(user.id, id);
  }

  // ---- Pruned history / restore ---------------------------------------------------

  @Get('prunes')
  async listPrunes(
    @CurrentUser() user: AuthUser,
    @Query('take') takeRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('mediaType') mediaType?: string,
    @Query('restored') restoredRaw?: string,
    @Query('search') search?: string,
    @Query('runId') runIdRaw?: string,
  ) {
    return await this.cuttingRoom.listPrunes({
      userId: user.id,
      take: parseIntParam(takeRaw, 50, 200),
      skip: parseIntParam(skipRaw, 0, 1_000_000),
      mediaType: mediaType || undefined,
      runId: runIdRaw || undefined,
      restored:
        restoredRaw === 'true'
          ? true
          : restoredRaw === 'false'
            ? false
            : undefined,
      search: search || undefined,
    });
  }

  @Post('prunes/:id/restore')
  async restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.cuttingRoom.invalidateFanoutCache(user.id);
    return await this.cuttingRoom.restorePrune(user.id, id);
  }

  // ---- Duplicates -------------------------------------------------------------------

  @Get('duplicates')
  async listDuplicates(
    @CurrentUser() user: AuthUser,
    @Query('sectionKey') sectionKey?: string,
  ) {
    return await this.cuttingRoom.listDuplicates(user.id, sectionKey || null);
  }

  @Post('duplicates/cleanup')
  async duplicateCleanup(
    @CurrentUser() user: AuthUser,
    @Body() body: DuplicateCleanupDto,
  ) {
    const dryRun = body.dryRun === true;
    const count = (body.ratingKeys ?? []).length;
    if (count === 0) {
      throw new BadRequestException('Nothing selected');
    }
    if (!dryRun) {
      const confirmation = (body.confirmation ?? '').trim();
      if (
        confirmation !== String(count) &&
        confirmation.toUpperCase() !== 'PRUNE'
      ) {
        throw new BadRequestException(
          `Confirmation mismatch: type the movie count (${count}) or "PRUNE"`,
        );
      }
    }
    if (!body.dryRun) this.cuttingRoom.invalidateFanoutCache(user.id);
    const run = await this.jobsService.runJob({
      jobId: 'cuttingRoomDuplicates',
      trigger: 'manual',
      dryRun,
      userId: user.id,
      input: {
        ratingKeys: body.ratingKeys,
        deletePreference: body.deletePreference,
      },
    });
    return { run };
  }

  // ---- Large files -------------------------------------------------------------------

  @Get('large-files')
  async listLargeFiles(
    @CurrentUser() user: AuthUser,
    @Query('threshold') thresholdRaw?: string,
    @Query('mediaType') mediaTypeRaw?: string,
    @Query('sectionKeys') sectionKeysRaw?: string,
    @Query('instanceIds') instanceIdsRaw?: string,
  ) {
    const thresholdGb = Number.parseFloat(thresholdRaw ?? '');
    const thresholdBytes =
      Number.isFinite(thresholdGb) && thresholdGb > 0
        ? thresholdGb * 1e9
        : 10e9;
    const mediaType =
      mediaTypeRaw === 'movie' || mediaTypeRaw === 'show'
        ? mediaTypeRaw
        : 'both';
    const splitCsv = (raw?: string) =>
      (raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return await this.cuttingRoom.listLargeFiles(user.id, thresholdBytes, {
      mediaType,
      sectionKeys: splitCsv(sectionKeysRaw),
      instanceIds: splitCsv(instanceIdsRaw),
    });
  }

  @Post('large-files/replace')
  async largeFilesReplace(
    @CurrentUser() user: AuthUser,
    @Body() body: LargeFilesReplaceDto,
  ) {
    const dryRun = body.dryRun === true;
    const count = (body.items ?? []).length;
    if (count === 0) {
      throw new BadRequestException('Nothing selected');
    }
    if (!dryRun) {
      const confirmation = (body.confirmation ?? '').trim();
      if (
        confirmation !== String(count) &&
        confirmation.toUpperCase() !== 'PRUNE'
      ) {
        throw new BadRequestException(
          `Confirmation mismatch: type the item count (${count}) or "PRUNE"`,
        );
      }
    }
    if (!body.dryRun) this.cuttingRoom.invalidateFanoutCache(user.id);
    const run = await this.jobsService.runJob({
      jobId: 'cuttingRoomLargeFiles',
      trigger: 'manual',
      dryRun,
      userId: user.id,
      input: {
        items: body.items as unknown as JsonObject[],
      } as unknown as JsonObject,
    });
    return { run };
  }

  // ---- Wanted list -----------------------------------------------------------------

  @Get('wanted')
  async listWanted(
    @CurrentUser() user: AuthUser,
    @Query('type') typeRaw?: string,
    @Query('instanceId') instanceId?: string,
    @Query('take') takeRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('search') search?: string,
  ) {
    const type = typeRaw === 'sonarr' ? 'sonarr' : 'radarr';
    const all = await this.wanted.listWanted({
      userId: user.id,
      type,
      instanceId: instanceId || null,
    });
    const needle = (search ?? '').trim().toLowerCase();
    const filtered = needle
      ? all.filter((w) => w.title.toLowerCase().includes(needle))
      : all;
    const skip = parseIntParam(skipRaw, 0, 1_000_000);
    const take = parseIntParam(takeRaw, 50, 200);
    return {
      total: filtered.length,
      items: filtered.slice(skip, skip + take),
    };
  }

  @Post('wanted/prune')
  async wantedPrune(
    @CurrentUser() user: AuthUser,
    @Body() body: WantedPruneDto,
  ) {
    const dryRun = body.dryRun === true;
    const targetCount =
      body.all === true
        ? (
            await this.wanted.listWanted({
              userId: user.id,
              type: body.type,
              instanceId: body.instanceId || null,
            })
          ).length
        : (body.arrIds ?? []).length;
    if (targetCount === 0) {
      throw new BadRequestException('Nothing selected');
    }
    if (!dryRun) {
      const confirmation = (body.confirmation ?? '').trim();
      if (
        confirmation !== String(targetCount) &&
        confirmation.toUpperCase() !== 'PRUNE'
      ) {
        throw new BadRequestException(
          `Confirmation mismatch: type the entry count (${targetCount}) or "PRUNE"`,
        );
      }
    }
    const input: JsonObject = {
      type: body.type,
      mode: body.mode,
      addImportExclusion: body.addImportExclusion === true,
      ...(body.instanceId ? { instanceId: body.instanceId } : {}),
      ...(body.all === true ? { all: true } : { arrIds: body.arrIds ?? [] }),
    };
    const run = await this.jobsService.runJob({
      jobId: 'cuttingRoomWantedPrune',
      trigger: 'manual',
      dryRun,
      userId: user.id,
      input,
    });
    return { run, targetCount };
  }
}
