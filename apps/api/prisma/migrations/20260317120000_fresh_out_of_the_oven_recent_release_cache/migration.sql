CREATE TABLE "FreshReleaseMovieLibrary" (
    "librarySectionKey" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT,
    "releaseDate" DATETIME,
    "tmdbPosterPath" TEXT,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("librarySectionKey", "tmdbId")
);

CREATE INDEX "FreshReleaseMovieLibrary_librarySectionKey_releaseDate_idx"
ON "FreshReleaseMovieLibrary"("librarySectionKey", "releaseDate");

CREATE INDEX "FreshReleaseMovieLibrary_librarySectionKey_lastCheckedAt_idx"
ON "FreshReleaseMovieLibrary"("librarySectionKey", "lastCheckedAt");
