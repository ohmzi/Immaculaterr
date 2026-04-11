-- CreateTable (idempotent: supports reruns after partial SQLite recovery)
CREATE TABLE IF NOT EXISTS "AutoRunMediaHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "mediaFingerprint" TEXT NOT NULL,
    "plexUserId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "librarySectionKey" TEXT NOT NULL,
    "seedRatingKey" TEXT,
    "showRatingKey" TEXT,
    "seedTitle" TEXT,
    "seedYear" INTEGER,
    "seasonNumber" INTEGER,
    "episodeNumber" INTEGER,
    "source" TEXT NOT NULL,
    "firstRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "AutoRunMediaHistory_jobId_mediaFingerprint_key" ON "AutoRunMediaHistory"("jobId", "mediaFingerprint");

CREATE INDEX IF NOT EXISTS "AutoRunMediaHistory_jobId_plexUserId_librarySectionKey_createdAt_idx" ON "AutoRunMediaHistory"("jobId", "plexUserId", "librarySectionKey", "createdAt");
