CREATE TABLE IF NOT EXISTS "FreshReleaseShowLibrary" (
    "librarySectionKey" TEXT NOT NULL,
    "tvdbId" INTEGER NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT,
    "firstAirDate" DATETIME,
    "tmdbPosterPath" TEXT,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("librarySectionKey", "tvdbId")
);

CREATE INDEX IF NOT EXISTS "FreshReleaseShowLibrary_librarySectionKey_firstAirDate_idx"
ON "FreshReleaseShowLibrary"("librarySectionKey", "firstAirDate");

CREATE INDEX IF NOT EXISTS "FreshReleaseShowLibrary_librarySectionKey_lastCheckedAt_idx"
ON "FreshReleaseShowLibrary"("librarySectionKey", "lastCheckedAt");
