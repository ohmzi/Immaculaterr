import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const TARGET_MIGRATION = '20260224090000_auth_security_hardening';
const PRISMA_BIN_CANDIDATES = [
  './apps/api/node_modules/.bin/prisma',
  './node_modules/.bin/prisma',
];
const PRISMA_SCHEMA_CANDIDATES = [
  'apps/api/prisma/schema.prisma',
  'prisma/schema.prisma',
];
const TARGET_MIGRATION_STATUS_QUERY = [
  'SELECT "finished_at", "rolled_back_at"',
  '   FROM "_prisma_migrations"',
  '  WHERE "migration_name" = ?',
  '  ORDER BY "started_at" DESC',
  '  LIMIT 1',
].join('\n');
const NORMALIZE_LEGACY_SESSION_TIMESTAMPS_SQL = [
  'UPDATE "Session"',
  '   SET "lastSeenAt" = datetime(CAST("lastSeenAt" AS INTEGER) / 1000, \'unixepoch\')',
  ' WHERE "lastSeenAt" IS NOT NULL',
  '   AND CAST("lastSeenAt" AS TEXT) != \'\'',
  '   AND CAST("lastSeenAt" AS TEXT) NOT GLOB \'*[^0-9]*\'',
].join('\n');
const CREATE_NEW_SESSION_TABLE_SQL = [
  'CREATE TABLE "new_Session" (',
  '  "id" TEXT NOT NULL PRIMARY KEY,',
  '  "userId" TEXT NOT NULL,',
  '  "tokenVersion" INTEGER NOT NULL,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "lastSeenAt" DATETIME NOT NULL,',
  '  "expiresAt" DATETIME NOT NULL,',
  '  CONSTRAINT "Session_userId_fkey"',
  '    FOREIGN KEY ("userId") REFERENCES "User" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE',
  ')',
].join('\n');
const COPY_SESSION_ROWS_SQL = [
  'INSERT INTO "new_Session" ("id", "userId", "tokenVersion", "createdAt", "lastSeenAt", "expiresAt")',
  'SELECT',
  '  s."id",',
  '  s."userId",',
  '  COALESCE(u."tokenVersion", 0),',
  '  s."createdAt",',
  '  CASE',
  "    WHEN typeof(s.\"lastSeenAt\") IN ('integer', 'real') THEN datetime(CAST(s.\"lastSeenAt\" AS INTEGER) / 1000, 'unixepoch')",
  '    WHEN CAST(s."lastSeenAt" AS TEXT) != \'\' AND CAST(s."lastSeenAt" AS TEXT) NOT GLOB \'*[^0-9]*\' THEN datetime(CAST(s."lastSeenAt" AS INTEGER) / 1000, \'unixepoch\')',
  '    WHEN datetime(s."lastSeenAt") IS NOT NULL THEN datetime(s."lastSeenAt")',
  '    ELSE CURRENT_TIMESTAMP',
  '  END,',
  '  CASE',
  "    WHEN typeof(s.\"lastSeenAt\") IN ('integer', 'real') THEN datetime(CAST(s.\"lastSeenAt\" AS INTEGER) / 1000, 'unixepoch', '+1 day')",
  "    WHEN CAST(s.\"lastSeenAt\" AS TEXT) != '' AND CAST(s.\"lastSeenAt\" AS TEXT) NOT GLOB '*[^0-9]*' THEN datetime(CAST(s.\"lastSeenAt\" AS INTEGER) / 1000, 'unixepoch', '+1 day')",
  '    WHEN datetime(s."lastSeenAt") IS NOT NULL THEN datetime(s."lastSeenAt", \'+1 day\')',
  "    ELSE datetime(CURRENT_TIMESTAMP, '+1 day')",
  '  END',
  'FROM "Session" s',
  'LEFT JOIN "User" u ON u."id" = s."userId"',
].join('\n');

type TableInfoRow = {
  name: string;
};

type MigrationStatusRow = {
  finished_at: number | null;
  rolled_back_at: number | null;
};

const isMissingMigrationsTableError = (err: unknown): boolean => (
  err instanceof Error &&
  err.message.includes('no such table: _prisma_migrations')
);

(function() {
  function resolveExistingPath(paths: string[], kind: string): string {
    const match = paths.find((candidate) => existsSync(candidate));
    if (match) return match;

    throw new Error(`Unable to locate ${kind}. Checked: ${paths.join(', ')}`);
  }
})();

const runPrisma = (args: string[], label: string): void => {
  const prismaBin = resolveExistingPath(PRISMA_BIN_CANDIDATES, 'Prisma CLI');
  const prismaSchema = resolveExistingPath(
    PRISMA_SCHEMA_CANDIDATES,
    'Prisma schema',
  );
  const result = spawnSync(prismaBin, [...args, '--schema', prismaSchema], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? 1})`);
  }
};

const hasColumn = (rows: TableInfoRow[], column: string): boolean => {
  return rows.some((row) => row.name === column);
};

export async function tableInfo(
  prisma: PrismaClient,
  table: string,
): Promise<TableInfoRow[]> {
  return await prisma.$queryRawUnsafe<TableInfoRow[]>(
    `PRAGMA table_info("${table}")`,
  );
}

async function hasFailedTargetMigration(
  prisma: PrismaClient,
): Promise<boolean> {
  let rows: MigrationStatusRow[];
  try {
    rows = await prisma.$queryRawUnsafe<MigrationStatusRow[]>(
      TARGET_MIGRATION_STATUS_QUERY,
      TARGET_MIGRATION,
    );
  } catch (err) {
    if (isMissingMigrationsTableError(err)) return false;
    throw err;
  }

  if (rows.length === 0) return false;
  return rows[0].finished_at == null && rows[0].rolled_back_at == null;
}

const normalizeLegacySessionTimestamps = async (prisma: PrismaClient) => {
  await prisma.$executeRawUnsafe(NORMALIZE_LEGACY_SESSION_TIMESTAMPS_SQL);
};

export async function repairPartialSessionSchema(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe('PRAGMA defer_foreign_keys=ON');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys=OFF');
  try {
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "new_Session"');
    await prisma.$executeRawUnsafe(CREATE_NEW_SESSION_TABLE_SQL);

    await prisma.$executeRawUnsafe(COPY_SESSION_ROWS_SQL);

    await prisma.$executeRawUnsafe('DROP TABLE "Session"');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "new_Session" RENAME TO "Session"',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt")',
    );
  } finally {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON');
    await prisma.$executeRawUnsafe('PRAGMA defer_foreign_keys=OFF');
  }
}

const isSessionSchemaUpgraded = (columns: TableInfoRow[]): boolean => {
  return hasColumn(columns, 'tokenVersion') && hasColumn(columns, 'expiresAt');
};

const shouldRepairPartialSessionSchema = (
  sessionColumns: TableInfoRow[],
  userColumns: TableInfoRow[],
): boolean => {
  return (
    !isSessionSchemaUpgraded(sessionColumns) &&
    hasColumn(userColumns, 'tokenVersion')
  );
};

export function resolveTargetMigrationState(sessionSchemaUpgraded: boolean): void {
  if (sessionSchemaUpgraded) {
    runPrisma(
      ['migrate', 'resolve', '--applied', TARGET_MIGRATION],
      'prisma migrate resolve --applied',
    );
    return;
  }

  runPrisma(
    ['migrate', 'resolve', '--rolled-back', TARGET_MIGRATION],
    'prisma migrate resolve --rolled-back',
  );
}

export const repairFailedMigrationIfNeeded = async (
  prisma: PrismaClient,
): Promise<void> => {
  const failedMigration = await hasFailedTargetMigration(prisma);
  if (!failedMigration) return;

  // Old installs stored Session.lastSeenAt as epoch milliseconds.
  // Normalize before retrying migration logic.
  await normalizeLegacySessionTimestamps(prisma);

  let sessionInfo = await tableInfo(prisma, 'Session');
  const userInfo = await tableInfo(prisma, 'User');

  if (shouldRepairPartialSessionSchema(sessionInfo, userInfo)) {
    await repairPartialSessionSchema(prisma);
    sessionInfo = await tableInfo(prisma, 'Session');
  }

  resolveTargetMigrationState(isSessionSchemaUpgraded(sessionInfo));
};

(async () => {
  const prisma = new PrismaClient();
  try {
    await repairFailedMigrationIfNeeded(prisma);

    runPrisma(['migrate', 'deploy'], 'prisma migrate deploy');
  } finally {
    await prisma.$disconnect();
  }
})();

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    `[migrate-with-repair] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  process.exit(1);
});
