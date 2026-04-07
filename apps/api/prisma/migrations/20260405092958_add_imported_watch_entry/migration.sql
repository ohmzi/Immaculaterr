/*
  Warnings:

  - The primary key for the `ImmaculateTasteMovieLibrary` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `ImmaculateTasteShowLibrary` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- CreateTable
CREATE TABLE "ArrInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "rootFolderPath" TEXT,
    "qualityProfileId" INTEGER,
    "tagId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArrInstance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportedWatchEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawTitle" TEXT NOT NULL,
    "parsedTitle" TEXT NOT NULL,
    "watchedAt" DATETIME,
    "mediaType" TEXT,
    "tmdbId" INTEGER,
    "tvdbId" INTEGER,
    "matchedTitle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportedWatchEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImmaculateTasteMovieLibrary" (
    "plexUserId" TEXT NOT NULL,
    "librarySectionKey" TEXT NOT NULL,
    "profileId" TEXT NOT NULL DEFAULT 'default',
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "releaseDate" DATETIME,
    "downloadApproval" TEXT NOT NULL DEFAULT 'none',
    "sentToRadarrAt" DATETIME,
    "sentToSonarrAt" DATETIME,
    "tmdbPosterPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("plexUserId", "librarySectionKey", "profileId", "tmdbId"),
    CONSTRAINT "ImmaculateTasteMovieLibrary_plexUserId_fkey" FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImmaculateTasteMovieLibrary" ("createdAt", "downloadApproval", "librarySectionKey", "plexUserId", "points", "releaseDate", "sentToRadarrAt", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt") SELECT "createdAt", "downloadApproval", "librarySectionKey", "plexUserId", "points", "releaseDate", "sentToRadarrAt", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt" FROM "ImmaculateTasteMovieLibrary";
DROP TABLE "ImmaculateTasteMovieLibrary";
ALTER TABLE "new_ImmaculateTasteMovieLibrary" RENAME TO "ImmaculateTasteMovieLibrary";
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId");
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey");
CREATE INDEX "ImmaculateTasteMovieLibrary_profileId_idx" ON "ImmaculateTasteMovieLibrary"("profileId");
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_status_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey", "status");
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_points_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey", "points");
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey", "tmdbVoteAvg");
CREATE INDEX "ImmaculateTasteMovieLibrary_releaseDate_idx" ON "ImmaculateTasteMovieLibrary"("releaseDate");
CREATE TABLE "new_ImmaculateTasteShowLibrary" (
    "plexUserId" TEXT NOT NULL,
    "librarySectionKey" TEXT NOT NULL,
    "profileId" TEXT NOT NULL DEFAULT 'default',
    "tvdbId" INTEGER NOT NULL,
    "tmdbId" INTEGER,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "firstAirDate" DATETIME,
    "downloadApproval" TEXT NOT NULL DEFAULT 'none',
    "sentToRadarrAt" DATETIME,
    "sentToSonarrAt" DATETIME,
    "tmdbPosterPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("plexUserId", "librarySectionKey", "profileId", "tvdbId"),
    CONSTRAINT "ImmaculateTasteShowLibrary_plexUserId_fkey" FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImmaculateTasteShowLibrary" ("createdAt", "downloadApproval", "firstAirDate", "librarySectionKey", "plexUserId", "points", "sentToRadarrAt", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt") SELECT "createdAt", "downloadApproval", "firstAirDate", "librarySectionKey", "plexUserId", "points", "sentToRadarrAt", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt" FROM "ImmaculateTasteShowLibrary";
DROP TABLE "ImmaculateTasteShowLibrary";
ALTER TABLE "new_ImmaculateTasteShowLibrary" RENAME TO "ImmaculateTasteShowLibrary";
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_idx" ON "ImmaculateTasteShowLibrary"("plexUserId");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey");
CREATE INDEX "ImmaculateTasteShowLibrary_profileId_idx" ON "ImmaculateTasteShowLibrary"("profileId");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_tmdbId_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "tmdbId");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_status_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey", "status");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_points_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey", "points");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey", "tmdbVoteAvg");
CREATE INDEX "ImmaculateTasteShowLibrary_firstAirDate_idx" ON "ImmaculateTasteShowLibrary"("firstAirDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ArrInstance_userId_type_idx" ON "ArrInstance"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ArrInstance_userId_type_name_key" ON "ArrInstance"("userId", "type", "name");

-- CreateIndex
CREATE INDEX "ImportedWatchEntry_userId_source_idx" ON "ImportedWatchEntry"("userId", "source");

-- CreateIndex
CREATE INDEX "ImportedWatchEntry_userId_status_idx" ON "ImportedWatchEntry"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedWatchEntry_userId_source_parsedTitle_key" ON "ImportedWatchEntry"("userId", "source", "parsedTitle");
