-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImmaculateTasteMovieLibrary" (
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

    PRIMARY KEY ("librarySectionKey", "tmdbId")
);
INSERT INTO "new_ImmaculateTasteMovieLibrary" ("createdAt", "librarySectionKey", "points", "status", "title", "tmdbId", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt") SELECT "createdAt", "librarySectionKey", "points", "status", "title", "tmdbId", "tmdbVoteAvg", "tmdbVoteCount", "updatedAt" FROM "ImmaculateTasteMovieLibrary";
DROP TABLE "ImmaculateTasteMovieLibrary";
ALTER TABLE "new_ImmaculateTasteMovieLibrary" RENAME TO "ImmaculateTasteMovieLibrary";
CREATE INDEX "ImmaculateTasteMovieLibrary_librarySectionKey_idx" ON "ImmaculateTasteMovieLibrary"("librarySectionKey");
CREATE INDEX "ImmaculateTasteMovieLibrary_librarySectionKey_status_idx" ON "ImmaculateTasteMovieLibrary"("librarySectionKey", "status");
CREATE INDEX "ImmaculateTasteMovieLibrary_librarySectionKey_points_idx" ON "ImmaculateTasteMovieLibrary"("librarySectionKey", "points");
CREATE INDEX "ImmaculateTasteMovieLibrary_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteMovieLibrary"("librarySectionKey", "tmdbVoteAvg");
CREATE TABLE "new_ImmaculateTasteShowLibrary" (
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

    PRIMARY KEY ("librarySectionKey", "tvdbId")
);
INSERT INTO "new_ImmaculateTasteShowLibrary" ("createdAt", "librarySectionKey", "points", "status", "title", "tmdbId", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt") SELECT "createdAt", "librarySectionKey", "points", "status", "title", "tmdbId", "tmdbVoteAvg", "tmdbVoteCount", "tvdbId", "updatedAt" FROM "ImmaculateTasteShowLibrary";
DROP TABLE "ImmaculateTasteShowLibrary";
ALTER TABLE "new_ImmaculateTasteShowLibrary" RENAME TO "ImmaculateTasteShowLibrary";
CREATE INDEX "ImmaculateTasteShowLibrary_librarySectionKey_idx" ON "ImmaculateTasteShowLibrary"("librarySectionKey");
CREATE INDEX "ImmaculateTasteShowLibrary_tmdbId_idx" ON "ImmaculateTasteShowLibrary"("tmdbId");
CREATE INDEX "ImmaculateTasteShowLibrary_librarySectionKey_status_idx" ON "ImmaculateTasteShowLibrary"("librarySectionKey", "status");
CREATE INDEX "ImmaculateTasteShowLibrary_librarySectionKey_points_idx" ON "ImmaculateTasteShowLibrary"("librarySectionKey", "points");
CREATE INDEX "ImmaculateTasteShowLibrary_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteShowLibrary"("librarySectionKey", "tmdbVoteAvg");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
