-- CreateTable
CREATE TABLE "WatchedMovieRecommendation" (
    "collectionName" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("collectionName", "tmdbId")
);

-- CreateIndex
CREATE INDEX "WatchedMovieRecommendation_collectionName_status_idx" ON "WatchedMovieRecommendation"("collectionName", "status");

-- CreateIndex
CREATE INDEX "WatchedMovieRecommendation_collectionName_points_idx" ON "WatchedMovieRecommendation"("collectionName", "points");

-- CreateIndex
CREATE INDEX "WatchedMovieRecommendation_collectionName_tmdbVoteAvg_idx" ON "WatchedMovieRecommendation"("collectionName", "tmdbVoteAvg");






