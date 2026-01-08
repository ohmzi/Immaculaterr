-- CreateTable
CREATE TABLE "ImmaculateTasteMovieLibrary" (
    "librarySectionKey" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("librarySectionKey", "tmdbId")
);

-- CreateTable
CREATE TABLE "WatchedMovieRecommendationLibrary" (
    "collectionName" TEXT NOT NULL,
    "librarySectionKey" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("collectionName", "librarySectionKey", "tmdbId")
);

-- CreateTable
CREATE TABLE "ImmaculateTasteShowLibrary" (
    "librarySectionKey" TEXT NOT NULL,
    "tvdbId" INTEGER NOT NULL,
    "tmdbId" INTEGER,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("librarySectionKey", "tvdbId")
);

-- CreateTable
CREATE TABLE "WatchedShowRecommendationLibrary" (
    "collectionName" TEXT NOT NULL,
    "librarySectionKey" TEXT NOT NULL,
    "tvdbId" INTEGER NOT NULL,
    "tmdbId" INTEGER,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("collectionName", "librarySectionKey", "tvdbId")
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImmaculateTasteMovieLegacy" (
    "ratingKey" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "points" INTEGER NOT NULL,
    "tmdbId" INTEGER,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ImmaculateTasteMovieLegacy" ("createdAt", "points", "ratingKey", "title", "tmdbId", "updatedAt") SELECT "createdAt", "points", "ratingKey", "title", "tmdbId", "updatedAt" FROM "ImmaculateTasteMovieLegacy";
DROP TABLE "ImmaculateTasteMovieLegacy";
ALTER TABLE "new_ImmaculateTasteMovieLegacy" RENAME TO "ImmaculateTasteMovieLegacy";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ImmaculateTasteMovieLibrary_librarySectionKey_idx" ON "ImmaculateTasteMovieLibrary"("librarySectionKey");

-- CreateIndex
CREATE INDEX "ImmaculateTasteMovieLibrary_librarySectionKey_status_idx" ON "ImmaculateTasteMovieLibrary"("librarySectionKey", "status");

-- CreateIndex
CREATE INDEX "ImmaculateTasteMovieLibrary_librarySectionKey_points_idx" ON "ImmaculateTasteMovieLibrary"("librarySectionKey", "points");

-- CreateIndex
CREATE INDEX "ImmaculateTasteMovieLibrary_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteMovieLibrary"("librarySectionKey", "tmdbVoteAvg");

-- CreateIndex
CREATE INDEX "WatchedMovieRecommendationLibrary_librarySectionKey_idx" ON "WatchedMovieRecommendationLibrary"("librarySectionKey");

-- CreateIndex
CREATE INDEX "WatchedMovieRecommendationLibrary_librarySectionKey_collectionName_status_idx" ON "WatchedMovieRecommendationLibrary"("librarySectionKey", "collectionName", "status");

-- CreateIndex
CREATE INDEX "WatchedMovieRecommendationLibrary_librarySectionKey_collectionName_points_idx" ON "WatchedMovieRecommendationLibrary"("librarySectionKey", "collectionName", "points");

-- CreateIndex
CREATE INDEX "WatchedMovieRecommendationLibrary_librarySectionKey_collectionName_tmdbVoteAvg_idx" ON "WatchedMovieRecommendationLibrary"("librarySectionKey", "collectionName", "tmdbVoteAvg");

-- CreateIndex
CREATE INDEX "WatchedMovieRecommendationLibrary_tmdbId_idx" ON "WatchedMovieRecommendationLibrary"("tmdbId");

-- CreateIndex
CREATE INDEX "ImmaculateTasteShowLibrary_librarySectionKey_idx" ON "ImmaculateTasteShowLibrary"("librarySectionKey");

-- CreateIndex
CREATE INDEX "ImmaculateTasteShowLibrary_tmdbId_idx" ON "ImmaculateTasteShowLibrary"("tmdbId");

-- CreateIndex
CREATE INDEX "ImmaculateTasteShowLibrary_librarySectionKey_status_idx" ON "ImmaculateTasteShowLibrary"("librarySectionKey", "status");

-- CreateIndex
CREATE INDEX "ImmaculateTasteShowLibrary_librarySectionKey_points_idx" ON "ImmaculateTasteShowLibrary"("librarySectionKey", "points");

-- CreateIndex
CREATE INDEX "ImmaculateTasteShowLibrary_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteShowLibrary"("librarySectionKey", "tmdbVoteAvg");

-- CreateIndex
CREATE INDEX "WatchedShowRecommendationLibrary_librarySectionKey_idx" ON "WatchedShowRecommendationLibrary"("librarySectionKey");

-- CreateIndex
CREATE INDEX "WatchedShowRecommendationLibrary_tmdbId_idx" ON "WatchedShowRecommendationLibrary"("tmdbId");

-- CreateIndex
CREATE INDEX "WatchedShowRecommendationLibrary_librarySectionKey_collectionName_status_idx" ON "WatchedShowRecommendationLibrary"("librarySectionKey", "collectionName", "status");

-- CreateIndex
CREATE INDEX "WatchedShowRecommendationLibrary_librarySectionKey_collectionName_points_idx" ON "WatchedShowRecommendationLibrary"("librarySectionKey", "collectionName", "points");

-- CreateIndex
CREATE INDEX "WatchedShowRecommendationLibrary_librarySectionKey_collectionName_tmdbVoteAvg_idx" ON "WatchedShowRecommendationLibrary"("librarySectionKey", "collectionName", "tmdbVoteAvg");
