import {
  COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY,
  COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY,
  COLLECTION_RESYNC_UPGRADE_JOB_ID,
  COLLECTION_RESYNC_UPGRADE_LAST_COMPLETED_VERSION_KEY,
  COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION,
} from './collection-resync-upgrade.job';
import { CollectionResyncUpgradeService } from './collection-resync-upgrade.service';

function createServiceFixture(params?: {
  settings?: Record<string, string>;
  firstUserId?: string | null;
}) {
  const settingsMap = new Map<string, string>(
    Object.entries(params?.settings ?? {}),
  );

  const prisma = {
    setting: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) => {
        const value = settingsMap.get(where.key);
        if (value === undefined) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ value });
      }),
    },
    user: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          params?.firstUserId === null
            ? null
            : { id: params?.firstUserId ?? 'u-1' },
        ),
      ),
    },
  };

  const jobsService = {
    runJob: jest.fn(() => Promise.resolve({ id: 'run-1' })),
  };

  const service = new CollectionResyncUpgradeService(
    prisma as never,
    jobsService as never,
  );
  const enqueueUpgradeRun = (
    service as unknown as {
      enqueueUpgradeRun: () => Promise<void>;
    }
  ).enqueueUpgradeRun.bind(service);

  return {
    prisma,
    jobsService,
    enqueueUpgradeRun,
  };
}

describe('CollectionResyncUpgradeService startup orchestration', () => {
  it('enqueues when v1_7_0 completion key is missing', async () => {
    const fixture = createServiceFixture();

    await fixture.enqueueUpgradeRun();

    expect(fixture.prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(fixture.jobsService.runJob).toHaveBeenCalledWith({
      jobId: COLLECTION_RESYNC_UPGRADE_JOB_ID,
      trigger: 'auto',
      dryRun: false,
      userId: 'u-1',
    });
  });

  it('skips when completedAt exists and release markers are valid', async () => {
    const fixture = createServiceFixture({
      settings: {
        [COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY]:
          '2026-02-17T00:00:00.000Z',
        [COLLECTION_RESYNC_UPGRADE_LAST_COMPLETED_VERSION_KEY]:
          COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION,
        [COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY]:
          '{"1.7.0":"2026-02-17T00:00:00.000Z"}',
      },
    });

    await fixture.enqueueUpgradeRun();

    expect(fixture.prisma.user.findFirst).not.toHaveBeenCalled();
    expect(fixture.jobsService.runJob).not.toHaveBeenCalled();
  });

  it('enqueues marker-backfill when completedAt exists but markers are missing', async () => {
    const fixture = createServiceFixture({
      settings: {
        [COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY]:
          '2026-02-17T00:00:00.000Z',
      },
    });

    await fixture.enqueueUpgradeRun();

    expect(fixture.prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(fixture.jobsService.runJob).toHaveBeenCalledTimes(1);
  });

  it('enqueues marker-backfill when completedVersions history is corrupt', async () => {
    const fixture = createServiceFixture({
      settings: {
        [COLLECTION_RESYNC_UPGRADE_COMPLETED_AT_KEY]:
          '2026-02-17T00:00:00.000Z',
        [COLLECTION_RESYNC_UPGRADE_LAST_COMPLETED_VERSION_KEY]:
          COLLECTION_RESYNC_UPGRADE_RELEASE_VERSION,
        [COLLECTION_RESYNC_UPGRADE_COMPLETED_VERSIONS_KEY]: '{invalid-json',
      },
    });

    await fixture.enqueueUpgradeRun();

    expect(fixture.prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(fixture.jobsService.runJob).toHaveBeenCalledTimes(1);
  });
});
