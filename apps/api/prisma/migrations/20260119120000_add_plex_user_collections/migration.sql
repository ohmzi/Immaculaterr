-- CreateTable
CREATE TABLE "PlexUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plexAccountId" INTEGER,
    "plexAccountTitle" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PlexUser_plexAccountId_key" ON "PlexUser"("plexAccountId");

-- CreateIndex
CREATE INDEX "PlexUser_plexAccountTitle_idx" ON "PlexUser"("plexAccountTitle");

-- CreateIndex
CREATE INDEX "PlexUser_isAdmin_idx" ON "PlexUser"("isAdmin");

-- Seed default admin Plex user for backfill
INSERT INTO "PlexUser" ("id", "plexAccountId", "plexAccountTitle", "isAdmin", "lastSeenAt", "createdAt", "updatedAt")
VALUES ('plex-admin', NULL, 'Admin', 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImmaculateTasteMovieLibrary" (
    "plexUserId" TEXT NOT NULL,
    "librarySectionKey" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "downloadApproval" TEXT NOT NULL DEFAULT 'none',
    "sentToRadarrAt" DATETIME,
    "sentToSonarrAt" DATETIME,
    "tmdbPosterPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("plexUserId", "librarySectionKey", "tmdbId"),
    CONSTRAINT "ImmaculateTasteMovieLibrary_plexUserId_fkey" FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImmaculateTasteMovieLibrary" ("plexUserId", "createdAt", "downloadApproval", "librarySectionKey", "points", "sentToRadarrAt", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt") SELECT 'plex-admin', "createdAt", "downloadApproval", "librarySectionKey", "points", "sentToRadarrAt", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt" FROM "ImmaculateTasteMovieLibrary";
DROP TABLE "ImmaculateTasteMovieLibrary";
ALTER TABLE "new_ImmaculateTasteMovieLibrary" RENAME TO "ImmaculateTasteMovieLibrary";
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId");
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey");
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_status_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey", "status");
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_points_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey", "points");
CREATE INDEX "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey", "tmdbVoteAvg");
CREATE TABLE "new_WatchedMovieRecommendationLibrary" (
    "plexUserId" TEXT NOT NULL,
    "collectionName" TEXT NOT NULL,
    "librarySectionKey" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "downloadApproval" TEXT NOT NULL DEFAULT 'none',
    "sentToRadarrAt" DATETIME,
    "tmdbPosterPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("plexUserId", "collectionName", "librarySectionKey", "tmdbId"),
    CONSTRAINT "WatchedMovieRecommendationLibrary_plexUserId_fkey" FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WatchedMovieRecommendationLibrary" ("plexUserId", "collectionName", "createdAt", "downloadApproval", "librarySectionKey", "sentToRadarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt") SELECT 'plex-admin', "collectionName", "createdAt", "downloadApproval", "librarySectionKey", "sentToRadarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt" FROM "WatchedMovieRecommendationLibrary";
DROP TABLE "WatchedMovieRecommendationLibrary";
ALTER TABLE "new_WatchedMovieRecommendationLibrary" RENAME TO "WatchedMovieRecommendationLibrary";
CREATE INDEX "WatchedMovieRecommendationLibrary_plexUserId_idx" ON "WatchedMovieRecommendationLibrary"("plexUserId");
CREATE INDEX "WatchedMovieRecommendationLibrary_plexUserId_librarySectionKey_idx" ON "WatchedMovieRecommendationLibrary"("plexUserId", "librarySectionKey");
CREATE INDEX "WatchedMovieRecommendationLibrary_plexUserId_librarySectionKey_collectionName_status_idx" ON "WatchedMovieRecommendationLibrary"("plexUserId", "librarySectionKey", "collectionName", "status");
CREATE INDEX "WatchedMovieRecommendationLibrary_plexUserId_librarySectionKey_collectionName_tmdbVoteAvg_idx" ON "WatchedMovieRecommendationLibrary"("plexUserId", "librarySectionKey", "collectionName", "tmdbVoteAvg");
CREATE INDEX "WatchedMovieRecommendationLibrary_plexUserId_librarySectionKey_collectionName_downloadApproval_idx" ON "WatchedMovieRecommendationLibrary"("plexUserId", "librarySectionKey", "collectionName", "downloadApproval");
CREATE INDEX "WatchedMovieRecommendationLibrary_plexUserId_librarySectionKey_collectionName_sentToRadarrAt_idx" ON "WatchedMovieRecommendationLibrary"("plexUserId", "librarySectionKey", "collectionName", "sentToRadarrAt");
CREATE INDEX "WatchedMovieRecommendationLibrary_plexUserId_tmdbId_idx" ON "WatchedMovieRecommendationLibrary"("plexUserId", "tmdbId");
CREATE TABLE "new_ImmaculateTasteShowLibrary" (
    "plexUserId" TEXT NOT NULL,
    "librarySectionKey" TEXT NOT NULL,
    "tvdbId" INTEGER NOT NULL,
    "tmdbId" INTEGER,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "downloadApproval" TEXT NOT NULL DEFAULT 'none',
    "sentToRadarrAt" DATETIME,
    "sentToSonarrAt" DATETIME,
    "tmdbPosterPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("plexUserId", "librarySectionKey", "tvdbId"),
    CONSTRAINT "ImmaculateTasteShowLibrary_plexUserId_fkey" FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImmaculateTasteShowLibrary" ("plexUserId", "createdAt", "downloadApproval", "librarySectionKey", "points", "sentToRadarrAt", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt") SELECT 'plex-admin', "createdAt", "downloadApproval", "librarySectionKey", "points", "sentToRadarrAt", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt" FROM "ImmaculateTasteShowLibrary";
DROP TABLE "ImmaculateTasteShowLibrary";
ALTER TABLE "new_ImmaculateTasteShowLibrary" RENAME TO "ImmaculateTasteShowLibrary";
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_idx" ON "ImmaculateTasteShowLibrary"("plexUserId");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_tmdbId_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "tmdbId");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_status_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey", "status");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_points_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey", "points");
CREATE INDEX "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey", "tmdbVoteAvg");
CREATE TABLE "new_WatchedShowRecommendationLibrary" (
    "plexUserId" TEXT NOT NULL,
    "collectionName" TEXT NOT NULL,
    "librarySectionKey" TEXT NOT NULL,
    "tvdbId" INTEGER NOT NULL,
    "tmdbId" INTEGER,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "downloadApproval" TEXT NOT NULL DEFAULT 'none',
    "sentToSonarrAt" DATETIME,
    "tmdbPosterPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("plexUserId", "collectionName", "librarySectionKey", "tvdbId"),
    CONSTRAINT "WatchedShowRecommendationLibrary_plexUserId_fkey" FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WatchedShowRecommendationLibrary" ("plexUserId", "collectionName", "createdAt", "downloadApproval", "librarySectionKey", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt") SELECT 'plex-admin', "collectionName", "createdAt", "downloadApproval", "librarySectionKey", "sentToSonarrAt", "status", "title", "tmdbId", "tmdbPosterPath", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt" FROM "WatchedShowRecommendationLibrary";
DROP TABLE "WatchedShowRecommendationLibrary";
ALTER TABLE "new_WatchedShowRecommendationLibrary" RENAME TO "WatchedShowRecommendationLibrary";
CREATE INDEX "WatchedShowRecommendationLibrary_plexUserId_idx" ON "WatchedShowRecommendationLibrary"("plexUserId");
CREATE INDEX "WatchedShowRecommendationLibrary_plexUserId_librarySectionKey_idx" ON "WatchedShowRecommendationLibrary"("plexUserId", "librarySectionKey");
CREATE INDEX "WatchedShowRecommendationLibrary_plexUserId_tmdbId_idx" ON "WatchedShowRecommendationLibrary"("plexUserId", "tmdbId");
CREATE INDEX "WatchedShowRecommendationLibrary_plexUserId_librarySectionKey_collectionName_status_idx" ON "WatchedShowRecommendationLibrary"("plexUserId", "librarySectionKey", "collectionName", "status");
CREATE INDEX "WatchedShowRecommendationLibrary_plexUserId_librarySectionKey_collectionName_tmdbVoteAvg_idx" ON "WatchedShowRecommendationLibrary"("plexUserId", "librarySectionKey", "collectionName", "tmdbVoteAvg");
CREATE INDEX "WatchedShowRecommendationLibrary_plexUserId_librarySectionKey_collectionName_downloadApproval_idx" ON "WatchedShowRecommendationLibrary"("plexUserId", "librarySectionKey", "collectionName", "downloadApproval");
CREATE INDEX "WatchedShowRecommendationLibrary_plexUserId_librarySectionKey_collectionName_sentToSonarrAt_idx" ON "WatchedShowRecommendationLibrary"("plexUserId", "librarySectionKey", "collectionName", "sentToSonarrAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
