import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { JobsService } from './jobs.service';
import {
  COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY,
  COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY,
  COLLECTION_RESYNC_UPGRADE_JOB_ID,
  COLLECTION_RESYNC_UPGRADE_LAST_COMPLETED_VERSION_KEY,
  COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION,
} from './collection-resync-upgrade.job';

function summarizeCompletedVersionHistory(raw: string): {
  count: number;
  parseError: boolean;
  hasCurrentRelease: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { count: 0, parseError: false, hasCurrentRelease: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { count: 0, parseError: true, hasCurrentRelease: false };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { count: 0, parseError: true, hasCurrentRelease: false };
  }

  let count = 0;
  let hasCurrentRelease = false;
  for (const [version, completedAt] of Object.entries(parsed)) {
    const versionKey = String(version ?? '').trim();
    const completedAtValue = String(completedAt ?? '').trim();
    if (!versionKey || !completedAtValue) continue;
    count += 1;
    if (versionKey === COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION) {
      hasCurrentRelease = true;
    }
  }
  return { count, parseError: false, hasCurrentRelease };
}

@Injectable()
export class CollectionResyncUpgradeService implements OnModuleInit {
  private readonly logger = new Logger(CollectionResyncUpgradeService.name);

  private static readonly STARTUP_DELAY_MS = 20_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
  ) {}

  onModuleInit() {
    // Keep startup non-blocking; run shortly after API boot.
    setTimeout(
      () => void this.enqueueUpgradeRun(),
      CollectionResyncUpgradeService.STARTUP_DELAY_MS,
    );
  }

  private async enqueueUpgradeRun() {
    const [completed, lastCompletedVersionRow, completedVersionsRow] =
      await Promise.all([
        this.prisma.setting
          .findUnique({
            where: { key: COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY },
          })
          .catch(() => null),
        this.prisma.setting
          .findUnique({
            where: {
              key: COLLECTION_RESYNC_UPGRADE_LAST_COMPLETED_VERSION_KEY,
            },
          })
          .catch(() => null),
        this.prisma.setting
          .findUnique({
            where: { key: COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY },
          })
          .catch(() => null),
      ]);
    const completedAt = completed?.value?.trim() ?? '';
    const lastCompletedVersion = lastCompletedVersionRow?.value?.trim() ?? '';
    const completedVersionsSummary = summarizeCompletedVersionHistory(
      completedVersionsRow?.value ?? '',
    );
    const markersNeedBackfill =
      Boolean(completedAt) &&
      (!lastCompletedVersion ||
        completedVersionsSummary.parseError ||
        !completedVersionsSummary.hasCurrentRelease);
    const runMode = completedAt ? 'marker_backfill' : 'full_resync';

    if (completedAt && !markersNeedBackfill) {
      this.logger.log(
        `Collection resync upgrade already completed at=${completedAt}; skipping startup run (lastCompletedVersion=${lastCompletedVersion || 'none'} completedVersions=${completedVersionsSummary.count} historyParseError=${completedVersionsSummary.parseError} hasCurrentRelease=${completedVersionsSummary.hasCurrentRelease})`,
      );
      return;
    }

    const firstUser = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!firstUser?.id) {
      this.logger.log(
        `Collection resync upgrade skipped at startup: no app user exists yet (mode=${runMode} lastCompletedVersion=${lastCompletedVersion || 'none'} completedVersions=${completedVersionsSummary.count} historyParseError=${completedVersionsSummary.parseError} hasCurrentRelease=${completedVersionsSummary.hasCurrentRelease})`,
      );
      return;
    }

    try {
      const run = await this.jobsService.runJob({
        jobId: COLLECTION_RESYNC_UPGRADE_JOB_ID,
        trigger: 'auto',
        dryRun: false,
        userId: firstUser.id,
      });
      this.logger.log(
        `Collection resync upgrade queued runId=${run.id} userId=${firstUser.id} trigger=auto mode=${runMode} (lastCompletedVersion=${lastCompletedVersion || 'none'} completedVersions=${completedVersionsSummary.count} historyParseError=${completedVersionsSummary.parseError} hasCurrentRelease=${completedVersionsSummary.hasCurrentRelease})`,
      );
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      // Best-effort startup orchestration: do not crash boot if migration launch fails.
      this.logger.warn(
        `Collection resync upgrade startup launch skipped: ${message}`,
      );
    }
  }
}
