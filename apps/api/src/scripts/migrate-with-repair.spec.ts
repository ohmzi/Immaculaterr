const mockSpawnSync = jest.fn();

jest.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args) as unknown,
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $disconnect: jest.fn(),
  })),
}));

import {
  logFailedMigrationDiagnostics,
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
    $executeRawUnsafe: jest.fn(async (sql: string) => {
      if (sql.includes('CREATE TABLE "ImmaculateTasteProfile"')) {
        mockState.tables.add('ImmaculateTasteProfile');
        mockState.columns.ImmaculateTasteProfile = ['id'];
      }
    }),
    $queryRawUnsafe: jest.fn(async (query: string, ...params: unknown[]) => {
      if (query.includes('FROM sqlite_master')) {
        const table = String(params[0]);
        return mockState.tables.has(table) ? [{ name: table }] : [];
      }

      const tableInfoMatch = query.match(/^PRAGMA table_info\("(.+)"\)$/);
      if (tableInfoMatch) {
        const table = tableInfoMatch[1];
        return (mockState.columns[table] ?? []).map((name) => ({ name }));
      }

      if (
        query.includes('FROM "_prisma_migrations"') &&
        query.includes('WHERE "migration_name" = ?')
      ) {
        const migrationName = String(params[0]);
        return mockState.migrationRows[migrationName] ?? [];
      }

      if (
        query.includes('FROM "_prisma_migrations"') &&
        query.includes('WHERE "finished_at" IS NULL')
      ) {
        return mockState.failedMigrations;
      }

      throw new Error(`Unexpected query in test: ${query}`);
    }),
  };
}

describe('scripts/migrate-with-repair', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
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
