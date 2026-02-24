-- Redefine User to add session revocation + password-proof metadata
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "passwordProofSalt" TEXT,
    "passwordProofIterations" INTEGER,
    "passwordProofKeyEnc" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("id", "username", "passwordHash", "tokenVersion", "passwordProofSalt", "passwordProofIterations", "passwordProofKeyEnc", "createdAt", "updatedAt")
SELECT "id", "username", "passwordHash", 0, NULL, NULL, NULL, "createdAt", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Redefine Session to add absolute expiry + tokenVersion pinning
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
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
LEFT JOIN "User" u ON u."id" = s."userId";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
