import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const TARGET_MIGRATION = '20260224090000_auth_security_hardening';
const PRISMA_BIN = './apps/api/node_modules/.bin/prisma';
const PRISMA_SCHEMA = 'apps/api/prisma/schema.prisma';

type TableInfoRow = {
  name: string;
};

type MigrationStatusRow = {
  finished_at: number | null;
  rolled_back_at: number | null;
};

function runPrisma(args: string[], label: string): void {
  const result = spawnSync(PRISMA_BIN, [...args, '--schema', PRISMA_SCHEMA], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? 1})`);
  }
}

function hasColumn(rows: TableInfoRow[], column: string): boolean {
  return rows.some((row) => row.name === column);
}

async function tableInfo(
  prisma: PrismaClient,
  table: string,
): Promise<TableInfoRow[]> {
  return await prisma.$queryRawUnsafe<TableInfoRow[]>(
    `PRAGMA table_info("${table}")`,
  );
}

async function hasFailedTargetMigration(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<MigrationStatusRow[]>(
    `SELECT "finished_at", "rolled_back_at"
       FROM "_prisma_migrations"
      WHERE "migration_name" = ?
      ORDER BY "started_at" DESC
      LIMIT 1`,
    TARGET_MIGRATION,
  );

  if (rows.length === 0) return false;
  return rows[0].finished_at == null && rows[0].rolled_back_at == null;
}

async function normalizeLegacySessionTimestamps(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    UPDATE "Session"
       SET "lastSeenAt" = datetime(CAST("lastSeenAt" AS INTEGER) / 1000, 'unixepoch')
     WHERE "lastSeenAt" IS NOT NULL
       AND CAST("lastSeenAt" AS TEXT) != ''
       AND CAST("lastSeenAt" AS TEXT) NOT GLOB '*[^0-9]*'
  `);
}

async function repairPartialSessionSchema(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe('PRAGMA defer_foreign_keys=ON');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys=OFF');
  try {
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "new_Session"');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "new_Session" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "tokenVersion" INTEGER NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastSeenAt" DATETIME NOT NULL,
        "expiresAt" DATETIME NOT NULL,
        CONSTRAINT "Session_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "new_Session" ("id", "userId", "tokenVersion", "createdAt", "lastSeenAt", "expiresAt")
      SELECT
        s."id",
        s."userId",
        COALESCE(u."tokenVersion", 0),
        s."createdAt",
        CASE
          WHEN typeof(s."lastSeenAt") IN ('integer', 'real') THEN datetime(CAST(s."lastSeenAt" AS INTEGER) / 1000, 'unixepoch')
          WHEN CAST(s."lastSeenAt" AS TEXT) != '' AND CAST(s."lastSeenAt" AS TEXT) NOT GLOB '*[^0-9]*' THEN datetime(CAST(s."lastSeenAt" AS INTEGER) / 1000, 'unixepoch')
          WHEN datetime(s."lastSeenAt") IS NOT NULL THEN datetime(s."lastSeenAt")
          ELSE CURRENT_TIMESTAMP
        END,
        CASE
          WHEN typeof(s."lastSeenAt") IN ('integer', 'real') THEN datetime(CAST(s."lastSeenAt" AS INTEGER) / 1000, 'unixepoch', '+1 day')
          WHEN CAST(s."lastSeenAt" AS TEXT) != '' AND CAST(s."lastSeenAt" AS TEXT) NOT GLOB '*[^0-9]*' THEN datetime(CAST(s."lastSeenAt" AS INTEGER) / 1000, 'unixepoch', '+1 day')
          WHEN datetime(s."lastSeenAt") IS NOT NULL THEN datetime(s."lastSeenAt", '+1 day')
          ELSE datetime(CURRENT_TIMESTAMP, '+1 day')
        END
      FROM "Session" s
      LEFT JOIN "User" u ON u."id" = s."userId"
    `);

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

async function main() {
  const prisma = new PrismaClient();
  try {
    const failedMigration = await hasFailedTargetMigration(prisma);
    if (failedMigration) {
      // Old installs stored Session.lastSeenAt as epoch milliseconds.
      // Normalize before retrying migration logic.
      await normalizeLegacySessionTimestamps(prisma);

      let sessionInfo = await tableInfo(prisma, 'Session');
      const userInfo = await tableInfo(prisma, 'User');

      const sessionAlreadyUpgraded =
        hasColumn(sessionInfo, 'tokenVersion') &&
        hasColumn(sessionInfo, 'expiresAt');
      const userAlreadyUpgraded = hasColumn(userInfo, 'tokenVersion');

      if (!sessionAlreadyUpgraded && userAlreadyUpgraded) {
        await repairPartialSessionSchema(prisma);
        sessionInfo = await tableInfo(prisma, 'Session');
      }

      const repairedSessionUpgraded =
        hasColumn(sessionInfo, 'tokenVersion') &&
        hasColumn(sessionInfo, 'expiresAt');

      if (repairedSessionUpgraded) {
        runPrisma(
          ['migrate', 'resolve', '--applied', TARGET_MIGRATION],
          'prisma migrate resolve --applied',
        );
      } else {
        runPrisma(
          ['migrate', 'resolve', '--rolled-back', TARGET_MIGRATION],
          'prisma migrate resolve --rolled-back',
        );
      }
    }

    runPrisma(['migrate', 'deploy'], 'prisma migrate deploy');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    `[migrate-with-repair] ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
  );
  process.exit(1);
});
