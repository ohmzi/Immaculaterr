-- CreateTable
CREATE TABLE "ImmaculateTasteMovie" (
    "ratingKey" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "points" INTEGER NOT NULL,
    "tmdbId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ImmaculateTasteMovie_points_idx" ON "ImmaculateTasteMovie"("points");
