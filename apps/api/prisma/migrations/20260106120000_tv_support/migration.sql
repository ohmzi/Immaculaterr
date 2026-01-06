-- CreateTable
CREATE TABLE "ImmaculateTasteShow" (
    "tvdbId" INTEGER NOT NULL PRIMARY KEY,
    "tmdbId" INTEGER,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ImmaculateTasteShow_tmdbId_idx" ON "ImmaculateTasteShow"("tmdbId");

-- CreateIndex
CREATE INDEX "ImmaculateTasteShow_status_idx" ON "ImmaculateTasteShow"("status");

-- CreateIndex
CREATE INDEX "ImmaculateTasteShow_points_idx" ON "ImmaculateTasteShow"("points");

-- CreateIndex
CREATE INDEX "ImmaculateTasteShow_tmdbVoteAvg_idx" ON "ImmaculateTasteShow"("tmdbVoteAvg");


-- CreateTable
CREATE TABLE "WatchedShowRecommendation" (
    "collectionName" TEXT NOT NULL,
    "tvdbId" INTEGER NOT NULL,
    "tmdbId" INTEGER,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("collectionName", "tvdbId")
);

-- CreateIndex
CREATE INDEX "WatchedShowRecommendation_tmdbId_idx" ON "WatchedShowRecommendation"("tmdbId");

-- CreateIndex
CREATE INDEX "WatchedShowRecommendation_collectionName_status_idx" ON "WatchedShowRecommendation"("collectionName", "status");

-- CreateIndex
CREATE INDEX "WatchedShowRecommendation_collectionName_points_idx" ON "WatchedShowRecommendation"("collectionName", "points");

-- CreateIndex
CREATE INDEX "WatchedShowRecommendation_collectionName_tmdbVoteAvg_idx" ON "WatchedShowRecommendation"("collectionName", "tmdbVoteAvg");

