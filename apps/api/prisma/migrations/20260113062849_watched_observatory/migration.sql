-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WatchedMovieRecommendationLibrary" (
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

    PRIMARY KEY ("collectionName", "librarySectionKey", "tmdbId")
);
INSERT INTO "new_WatchedMovieRecommendationLibrary" ("collectionName", "createdAt", "librarySectionKey", "status", "title", "tmdbId", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt") SELECT "collectionName", "createdAt", "librarySectionKey", "status", "title", "tmdbId", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt" FROM "WatchedMovieRecommendationLibrary";
DROP TABLE "WatchedMovieRecommendationLibrary";
ALTER TABLE "new_WatchedMovieRecommendationLibrary" RENAME TO "WatchedMovieRecommendationLibrary";
CREATE INDEX "WatchedMovieRecommendationLibrary_librarySectionKey_idx" ON "WatchedMovieRecommendationLibrary"("librarySectionKey");
CREATE INDEX "WatchedMovieRecommendationLibrary_librarySectionKey_collectionName_status_idx" ON "WatchedMovieRecommendationLibrary"("librarySectionKey", "collectionName", "status");
CREATE INDEX "WatchedMovieRecommendationLibrary_librarySectionKey_collectionName_tmdbVoteAvg_idx" ON "WatchedMovieRecommendationLibrary"("librarySectionKey", "collectionName", "tmdbVoteAvg");
CREATE INDEX "WatchedMovieRecommendationLibrary_librarySectionKey_collectionName_downloadApproval_idx" ON "WatchedMovieRecommendationLibrary"("librarySectionKey", "collectionName", "downloadApproval");
CREATE INDEX "WatchedMovieRecommendationLibrary_librarySectionKey_collectionName_sentToRadarrAt_idx" ON "WatchedMovieRecommendationLibrary"("librarySectionKey", "collectionName", "sentToRadarrAt");
CREATE INDEX "WatchedMovieRecommendationLibrary_tmdbId_idx" ON "WatchedMovieRecommendationLibrary"("tmdbId");
CREATE TABLE "new_WatchedShowRecommendationLibrary" (
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

    PRIMARY KEY ("collectionName", "librarySectionKey", "tvdbId")
);
INSERT INTO "new_WatchedShowRecommendationLibrary" ("collectionName", "createdAt", "librarySectionKey", "status", "title", "tmdbId", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt") SELECT "collectionName", "createdAt", "librarySectionKey", "status", "title", "tmdbId", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt" FROM "WatchedShowRecommendationLibrary";
DROP TABLE "WatchedShowRecommendationLibrary";
ALTER TABLE "new_WatchedShowRecommendationLibrary" RENAME TO "WatchedShowRecommendationLibrary";
CREATE INDEX "WatchedShowRecommendationLibrary_librarySectionKey_idx" ON "WatchedShowRecommendationLibrary"("librarySectionKey");
CREATE INDEX "WatchedShowRecommendationLibrary_tmdbId_idx" ON "WatchedShowRecommendationLibrary"("tmdbId");
CREATE INDEX "WatchedShowRecommendationLibrary_librarySectionKey_collectionName_status_idx" ON "WatchedShowRecommendationLibrary"("librarySectionKey", "collectionName", "status");
CREATE INDEX "WatchedShowRecommendationLibrary_librarySectionKey_collectionName_tmdbVoteAvg_idx" ON "WatchedShowRecommendationLibrary"("librarySectionKey", "collectionName", "tmdbVoteAvg");
CREATE INDEX "WatchedShowRecommendationLibrary_librarySectionKey_collectionName_downloadApproval_idx" ON "WatchedShowRecommendationLibrary"("librarySectionKey", "collectionName", "downloadApproval");
CREATE INDEX "WatchedShowRecommendationLibrary_librarySectionKey_collectionName_sentToSonarrAt_idx" ON "WatchedShowRecommendationLibrary"("librarySectionKey", "collectionName", "sentToSonarrAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
