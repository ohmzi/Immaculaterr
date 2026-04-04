-- CreateTable (idempotent: supports both fresh installs and existing databases
-- where the table was already provisioned by migrate-with-repair)
CREATE TABLE IF NOT EXISTS "ImmaculateTasteProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "mediaType" TEXT NOT NULL DEFAULT 'both',
    "matchMode" TEXT NOT NULL DEFAULT 'all',
    "genres" TEXT NOT NULL DEFAULT '[]',
    "audioLanguages" TEXT NOT NULL DEFAULT '[]',
    "excludedGenres" TEXT NOT NULL DEFAULT '[]',
    "excludedAudioLanguages" TEXT NOT NULL DEFAULT '[]',
    "radarrInstanceId" TEXT,
    "sonarrInstanceId" TEXT,
    "movieCollectionBaseName" TEXT,
    "showCollectionBaseName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImmaculateTasteProfile_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ImmaculateTasteProfileUserOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "plexUserId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'both',
    "matchMode" TEXT NOT NULL DEFAULT 'all',
    "genres" TEXT NOT NULL DEFAULT '[]',
    "audioLanguages" TEXT NOT NULL DEFAULT '[]',
    "excludedGenres" TEXT NOT NULL DEFAULT '[]',
    "excludedAudioLanguages" TEXT NOT NULL DEFAULT '[]',
    "radarrInstanceId" TEXT,
    "sonarrInstanceId" TEXT,
    "movieCollectionBaseName" TEXT,
    "showCollectionBaseName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImmaculateTasteProfileUserOverride_profileId_fkey"
        FOREIGN KEY ("profileId") REFERENCES "ImmaculateTasteProfile" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImmaculateTasteProfileUserOverride_plexUserId_fkey"
        FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ImmaculateTasteProfile_userId_name_key"
    ON "ImmaculateTasteProfile"("userId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImmaculateTasteProfile_userId_enabled_sortOrder_idx"
    ON "ImmaculateTasteProfile"("userId", "enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ImmaculateTasteProfileUserOverride_profileId_plexUserId_key"
    ON "ImmaculateTasteProfileUserOverride"("profileId", "plexUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImmaculateTasteProfileUserOverride_profileId_idx"
    ON "ImmaculateTasteProfileUserOverride"("profileId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImmaculateTasteProfileUserOverride_plexUserId_idx"
    ON "ImmaculateTasteProfileUserOverride"("plexUserId");
