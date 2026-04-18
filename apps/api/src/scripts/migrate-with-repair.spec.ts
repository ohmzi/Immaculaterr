const mockSpawnSync = jest.fn();
const mockExistsSync = jest.fn(() => true);

jest.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args) as unknown,
}));

jest.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $disconnect: jest.fn(),
  })),
}));

import {
  ensureImmaculateTasteLibraryReleaseDateColumns,
  ensureJobQueueStateSchema,
  ensureJobRunSchema,
  ensureLoginThrottleSchema,
  ensureRejectedSuggestionSchema,
  ensureUserRecoverySchema,
  logFailedMigrationDiagnostics,
  repairApril2026MigrationEdgeCases,
  repairMarch2026MigrationEdgeCases,
} from './migrate-with-repair';

type MigrationStatusRow = {
  finished_at: number | null;
  rolled_back_at: number | null;
};

type FailedMigrationRow = {
  migration_name: string;
  started_at: string | null;
};

type PrismaMockState = {
  columns: Record<string, string[]>;
  failedMigrations: FailedMigrationRow[];
  migrationRows: Record<string, MigrationStatusRow[]>;
  tables: Set<string>;
};

function createPrismaMock(state: Partial<PrismaMockState> = {}): {
  $executeRawUnsafe: jest.Mock<Promise<void>, [string]>;
  $queryRawUnsafe: jest.Mock<Promise<unknown>, [string, ...unknown[]]>;
} {
  const mockState: PrismaMockState = {
    columns: {},
    failedMigrations: [],
    migrationRows: {},
    tables: new Set<string>(),
    ...state,
    tables: new Set(state.tables ?? []),
  };

  return {
    $executeRawUnsafe: jest.fn((sql: string) => {
      if (sql.includes('CREATE TABLE "ImmaculateTasteProfile"')) {
        mockState.tables.add('ImmaculateTasteProfile');
        mockState.columns.ImmaculateTasteProfile = ['id'];
      }
      if (sql.includes('CREATE TABLE "ImportedWatchEntry"')) {
        mockState.tables.add('ImportedWatchEntry');
        mockState.columns.ImportedWatchEntry = ['id'];
      }
      if (sql.includes('CREATE TABLE "FreshReleaseShowLibrary"')) {
        mockState.tables.add('FreshReleaseShowLibrary');
        mockState.columns.FreshReleaseShowLibrary = [
          'librarySectionKey',
          'tvdbId',
        ];
      }
      if (sql.includes('CREATE TABLE "AutoRunMediaHistory"')) {
        mockState.tables.add('AutoRunMediaHistory');
        mockState.columns.AutoRunMediaHistory = ['id'];
      }
      if (
        sql.includes('ADD COLUMN "scopeAllUsers"') &&
        mockState.columns.ImmaculateTasteProfile
      ) {
        mockState.columns.ImmaculateTasteProfile.push('scopeAllUsers');
      }
      return Promise.resolve();
    }),
    $queryRawUnsafe: jest.fn((query: string, ...params: unknown[]) => {
      if (query.includes('FROM sqlite_master')) {
        const table = String(params[0]);
        return Promise.resolve(
          mockState.tables.has(table) ? [{ name: table }] : [],
        );
      }

      const tableInfoMatch = query.match(/^PRAGMA table_info\("(.+)"\)$/);
      if (tableInfoMatch) {
        const table = tableInfoMatch[1];
        return Promise.resolve(
          (mockState.columns[table] ?? []).map((name) => ({ name })),
        );
      }

      if (
        query.includes('FROM "_prisma_migrations"') &&
        query.includes('WHERE "migration_name" = ?')
      ) {
        const migrationName = String(params[0]);
        return Promise.resolve(mockState.migrationRows[migrationName] ?? []);
      }

      if (
        query.includes('FROM "_prisma_migrations"') &&
        query.includes('WHERE "finished_at" IS NULL')
      ) {
        return Promise.resolve(mockState.failedMigrations);
      }

      return Promise.reject(new Error(`Unexpected query in test: ${query}`));
    }),
  };
}

describe('scripts/migrate-with-repair', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReset();
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks scopeAllUsers migration as applied when the column already exists', async () => {
    const prisma = createPrismaMock({
      columns: {
        ImmaculateTasteProfile: ['id', 'scopeAllUsers'],
      },
      migrationRows: {
        '20260316200000_add_scope_all_users_to_taste_profile': [
          { finished_at: null, rolled_back_at: null },
        ],
      },
      tables: new Set(['User', 'ImmaculateTasteProfile']),
    });

    await repairMarch2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--applied',
        '20260316200000_add_scope_all_users_to_taste_profile',
        '--schema',
        expect.any(String),
      ]),
      expect.objectContaining({
        env: process.env,
        stdio: 'inherit',
      }),
    );
  });

  it('marks scopeAllUsers migration as rolled back when it is recorded as applied but the column is still missing', async () => {
    const prisma = createPrismaMock({
      columns: {
        ImmaculateTasteProfile: ['id'],
      },
      migrationRows: {
        '20260316200000_add_scope_all_users_to_taste_profile': [
          { finished_at: 1, rolled_back_at: null },
        ],
      },
      tables: new Set(['User', 'ImmaculateTasteProfile']),
    });

    await repairMarch2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--rolled-back',
        '20260316200000_add_scope_all_users_to_taste_profile',
        '--schema',
        expect.any(String),
      ]),
      expect.objectContaining({
        env: process.env,
        stdio: 'inherit',
      }),
    );
  });

  it('marks fresh release migration as rolled back when the table is missing', async () => {
    const prisma = createPrismaMock({
      columns: {
        ImmaculateTasteProfile: ['id', 'scopeAllUsers'],
      },
      migrationRows: {
        '20260316200000_add_scope_all_users_to_taste_profile': [
          { finished_at: 1, rolled_back_at: null },
        ],
        '20260317120000_fresh_out_of_the_oven_recent_release_cache': [
          { finished_at: null, rolled_back_at: null },
        ],
      },
      tables: new Set(['User', 'ImmaculateTasteProfile']),
    });

    await repairMarch2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--rolled-back',
        '20260317120000_fresh_out_of_the_oven_recent_release_cache',
        '--schema',
        expect.any(String),
      ]),
      expect.objectContaining({
        env: process.env,
        stdio: 'inherit',
      }),
    );
  });

  it('marks fresh release migration as rolled back when it is recorded as applied but the table is still missing', async () => {
    const prisma = createPrismaMock({
      columns: {
        ImmaculateTasteProfile: ['id', 'scopeAllUsers'],
      },
      migrationRows: {
        '20260316200000_add_scope_all_users_to_taste_profile': [
          { finished_at: 1, rolled_back_at: null },
        ],
        '20260317120000_fresh_out_of_the_oven_recent_release_cache': [
          { finished_at: 1, rolled_back_at: null },
        ],
      },
      tables: new Set(['User', 'ImmaculateTasteProfile']),
    });

    await repairMarch2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--rolled-back',
        '20260317120000_fresh_out_of_the_oven_recent_release_cache',
        '--schema',
        expect.any(String),
      ]),
      expect.objectContaining({
        env: process.env,
        stdio: 'inherit',
      }),
    );
  });

  it('skips all repairs when User table does not exist (fresh database)', async () => {
    const prisma = createPrismaMock({
      tables: new Set(),
    });

    await repairMarch2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('creates ImmaculateTasteProfile with scopeAllUsers and resolves both migrations when table is missing', async () => {
    const prisma = createPrismaMock({
      migrationRows: {
        '20260316200000_add_scope_all_users_to_taste_profile': [
          { finished_at: null, rolled_back_at: null },
        ],
      },
      tables: new Set(['User']),
    });

    await repairMarch2026MigrationEdgeCases(prisma as never);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE "ImmaculateTasteProfile"'),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN "scopeAllUsers"'),
    );
    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--applied',
        '20260316200000_add_scope_all_users_to_taste_profile',
      ]),
      expect.objectContaining({ env: process.env, stdio: 'inherit' }),
    );
  });

  it('resolves create_immaculate_taste_profiles migration as applied when table pre-exists but migration is unrecorded', async () => {
    const prisma = createPrismaMock({
      columns: {
        ImmaculateTasteProfile: ['id', 'scopeAllUsers'],
      },
      tables: new Set(['User', 'ImmaculateTasteProfile']),
    });

    await repairMarch2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--applied',
        '20260310120000_create_immaculate_taste_profiles',
      ]),
      expect.objectContaining({ env: process.env, stdio: 'inherit' }),
    );
  });

  it('creates ImportedWatchEntry and resolves the April migration as applied when ArrInstance pre-exists', async () => {
    const prisma = createPrismaMock({
      tables: new Set(['User', 'ArrInstance']),
    });

    await repairApril2026MigrationEdgeCases(prisma as never);

    expect(
      prisma.$executeRawUnsafe.mock.calls.some(
        ([sql]) =>
          sql.includes('CREATE TABLE') && sql.includes('"ImportedWatchEntry"'),
      ),
    ).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--applied',
        '20260405092958_add_imported_watch_entry',
      ]),
      expect.objectContaining({ env: process.env, stdio: 'inherit' }),
    );
  });

  it('resolves the April migration as applied when ImportedWatchEntry already exists but the row is failed', async () => {
    const prisma = createPrismaMock({
      migrationRows: {
        '20260405092958_add_imported_watch_entry': [
          { finished_at: null, rolled_back_at: null },
        ],
      },
      tables: new Set(['User', 'ImportedWatchEntry']),
    });

    await repairApril2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--applied',
        '20260405092958_add_imported_watch_entry',
      ]),
      expect.objectContaining({ env: process.env, stdio: 'inherit' }),
    );
  });

  it('skips April imported watch repair when the legacy tables are absent', async () => {
    const prisma = createPrismaMock({
      tables: new Set(['User']),
    });

    await repairApril2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(
      prisma.$executeRawUnsafe.mock.calls.some(([sql]) =>
        sql.includes('"ImportedWatchEntry"'),
      ),
    ).toBe(false);
  });

  it('resolves the auto-run media history migration as applied when the table pre-exists', async () => {
    const prisma = createPrismaMock({
      tables: new Set(['User', 'AutoRunMediaHistory']),
    });

    await repairApril2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--applied',
        '20260411120000_add_auto_run_media_history',
      ]),
      expect.objectContaining({ env: process.env, stdio: 'inherit' }),
    );
  });

  it('resolves the fresh release show migration as applied when the table pre-exists', async () => {
    const prisma = createPrismaMock({
      tables: new Set(['User', 'FreshReleaseShowLibrary']),
    });

    await repairApril2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--applied',
        '20260413120000_add_fresh_release_show_library',
      ]),
      expect.objectContaining({ env: process.env, stdio: 'inherit' }),
    );
  });

  it('resolves the fresh release show migration as rolled back when the table is missing but the row is failed', async () => {
    const prisma = createPrismaMock({
      migrationRows: {
        '20260413120000_add_fresh_release_show_library': [
          { finished_at: null, rolled_back_at: null },
        ],
      },
      tables: new Set(['User']),
    });

    await repairApril2026MigrationEdgeCases(prisma as never);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'migrate',
        'resolve',
        '--rolled-back',
        '20260413120000_add_fresh_release_show_library',
      ]),
      expect.objectContaining({ env: process.env, stdio: 'inherit' }),
    );
  });

  it('adds the releaseDate column and index to ImmaculateTasteMovieLibrary when the column is missing', async () => {
    const prisma = createPrismaMock({
      columns: {
        ImmaculateTasteMovieLibrary: ['plexUserId', 'tmdbId', 'profileId'],
        ImmaculateTasteShowLibrary: [
          'plexUserId',
          'tvdbId',
          'profileId',
          'firstAirDate',
        ],
      },
      tables: new Set([
        'ImmaculateTasteMovieLibrary',
        'ImmaculateTasteShowLibrary',
      ]),
    });

    await ensureImmaculateTasteLibraryReleaseDateColumns(prisma as never);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "ImmaculateTasteMovieLibrary" ADD COLUMN "releaseDate" DATETIME',
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'CREATE INDEX IF NOT EXISTS "ImmaculateTasteMovieLibrary_releaseDate_idx"',
      ),
    );
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalledWith(
      'ALTER TABLE "ImmaculateTasteShowLibrary" ADD COLUMN "firstAirDate" DATETIME',
    );
  });

  it('adds the firstAirDate column to ImmaculateTasteShowLibrary when the column is missing', async () => {
    const prisma = createPrismaMock({
      columns: {
        ImmaculateTasteShowLibrary: ['plexUserId', 'tvdbId', 'profileId'],
      },
      tables: new Set(['ImmaculateTasteShowLibrary']),
    });

    await ensureImmaculateTasteLibraryReleaseDateColumns(prisma as never);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "ImmaculateTasteShowLibrary" ADD COLUMN "firstAirDate" DATETIME',
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'CREATE INDEX IF NOT EXISTS "ImmaculateTasteShowLibrary_firstAirDate_idx"',
      ),
    );
  });

  it('skips ImmaculateTaste library release-date repairs when the tables do not exist', async () => {
    const prisma = createPrismaMock({ tables: new Set() });

    await ensureImmaculateTasteLibraryReleaseDateColumns(prisma as never);

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('adds every missing JobRun column introduced by later migrations', async () => {
    const prisma = createPrismaMock({
      columns: {
        JobRun: ['id', 'jobId', 'trigger', 'dryRun', 'status', 'startedAt'],
      },
      tables: new Set(['JobRun']),
    });

    await ensureJobRunSchema(prisma as never);

    const executedSql = prisma.$executeRawUnsafe.mock.calls.map(([sql]) => sql);
    for (const column of [
      'userId',
      'queuedAt',
      'executionStartedAt',
      'input',
      'queueFingerprint',
      'claimedAt',
      'heartbeatAt',
      'workerId',
    ]) {
      expect(executedSql).toContain(
        `ALTER TABLE "JobRun" ADD COLUMN "${column}" ${
          column === 'input'
            ? 'JSONB'
            : column.endsWith('At')
              ? 'DATETIME'
              : 'TEXT'
        }`,
      );
    }
    expect(executedSql).toContain(
      'UPDATE "JobRun" SET "queuedAt" = "startedAt" WHERE "queuedAt" IS NULL',
    );
    expect(executedSql).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"JobRun_status_queuedAt_id_idx"'),
        expect.stringContaining('"JobRun_status_executionStartedAt_idx"'),
        expect.stringContaining(
          '"JobRun_status_queueFingerprint_queuedAt_idx"',
        ),
        expect.stringContaining('"JobRun_userId_status_queuedAt_idx"'),
        expect.stringContaining('"JobRun_userId_startedAt_idx"'),
      ]),
    );
  });

  it('skips JobRun repairs when the table does not exist', async () => {
    const prisma = createPrismaMock({ tables: new Set() });

    await ensureJobRunSchema(prisma as never);

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('does not re-add JobRun columns that already exist', async () => {
    const prisma = createPrismaMock({
      columns: {
        JobRun: [
          'id',
          'jobId',
          'userId',
          'trigger',
          'dryRun',
          'status',
          'startedAt',
          'queuedAt',
          'executionStartedAt',
          'input',
          'queueFingerprint',
          'claimedAt',
          'heartbeatAt',
          'workerId',
        ],
      },
      tables: new Set(['JobRun']),
    });

    await ensureJobRunSchema(prisma as never);

    const executedSql = prisma.$executeRawUnsafe.mock.calls.map(([sql]) => sql);
    expect(executedSql.some((sql) => sql.includes('ADD COLUMN'))).toBe(false);
    expect(executedSql.some((sql) => sql.includes('BACKFILL'))).toBe(false);
  });

  it('creates JobQueueState and seeds the global row when the table is missing', async () => {
    const prisma = createPrismaMock({ tables: new Set() });

    await ensureJobQueueStateSchema(prisma as never);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE "JobQueueState"'),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO "JobQueueState"'),
    );
  });

  it('seeds the JobQueueState global row without recreating the table', async () => {
    const prisma = createPrismaMock({
      tables: new Set(['JobQueueState']),
    });

    await ensureJobQueueStateSchema(prisma as never);

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE "JobQueueState"'),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO "JobQueueState"'),
    );
  });

  it('adds the RejectedSuggestion.collectionKind column when it is missing', async () => {
    const prisma = createPrismaMock({
      columns: {
        RejectedSuggestion: ['id', 'userId', 'mediaType'],
      },
      tables: new Set(['RejectedSuggestion']),
    });

    await ensureRejectedSuggestionSchema(prisma as never);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'ALTER TABLE "RejectedSuggestion" ADD COLUMN "collectionKind" TEXT',
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        '"RejectedSuggestion_userId_mediaType_source_idx"',
      ),
    );
  });

  it('skips RejectedSuggestion repairs when the table does not exist', async () => {
    const prisma = createPrismaMock({ tables: new Set() });

    await ensureRejectedSuggestionSchema(prisma as never);

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('creates LoginThrottle when it is missing', async () => {
    const prisma = createPrismaMock({ tables: new Set() });

    await ensureLoginThrottleSchema(prisma as never);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE "LoginThrottle"'),
    );
  });

  it('does not recreate LoginThrottle when it already exists', async () => {
    const prisma = createPrismaMock({
      tables: new Set(['LoginThrottle']),
    });

    await ensureLoginThrottleSchema(prisma as never);

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('creates UserRecovery only once the User table exists', async () => {
    const withoutUser = createPrismaMock({ tables: new Set() });
    await ensureUserRecoverySchema(withoutUser as never);
    expect(withoutUser.$executeRawUnsafe).not.toHaveBeenCalled();

    const withUser = createPrismaMock({ tables: new Set(['User']) });
    await ensureUserRecoverySchema(withUser as never);
    expect(withUser.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE "UserRecovery"'),
    );
  });

  it('logs the exact failed migration names that still block deploy', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const prisma = createPrismaMock({
      failedMigrations: [
        {
          migration_name:
            '20260317120000_fresh_out_of_the_oven_recent_release_cache',
          started_at: '2026-03-17T12:00:00Z',
        },
      ],
    });

    await logFailedMigrationDiagnostics(prisma as never);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed Prisma migrations still blocking deploy: 20260317120000_fresh_out_of_the_oven_recent_release_cache',
      ),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '- 20260317120000_fresh_out_of_the_oven_recent_release_cache',
      ),
    );
  });
});
