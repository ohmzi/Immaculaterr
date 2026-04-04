-- AlterTable
ALTER TABLE "ImmaculateTasteMovieLibrary" ADD COLUMN "releaseDate" DATETIME;

-- AlterTable
ALTER TABLE "ImmaculateTasteShowLibrary" ADD COLUMN "firstAirDate" DATETIME;

-- CreateIndex
CREATE INDEX "ImmaculateTasteMovieLibrary_releaseDate_idx" ON "ImmaculateTasteMovieLibrary"("releaseDate");

-- CreateIndex
CREATE INDEX "ImmaculateTasteShowLibrary_firstAirDate_idx" ON "ImmaculateTasteShowLibrary"("firstAirDate");
