-- CreateTable: Library Curation feature (CurationSnapshot, CurationCandidate, PruneRecord)

CREATE TABLE "CurationSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'interactive',
    "mediaType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rulesJson" JSONB,
    "sectionKeys" JSONB,
    "analyzeRunId" TEXT,
    "pruneRunId" TEXT,
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "targetBytes" BIGINT,
    "libraryCount" INTEGER NOT NULL DEFAULT 0,
    "libraryBytes" BIGINT NOT NULL DEFAULT 0,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "candidateBytes" BIGINT NOT NULL DEFAULT 0,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "selectedBytes" BIGINT NOT NULL DEFAULT 0,
    "protectedJson" JSONB,
    "tierJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

CREATE TABLE "CurationCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "tier" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "watchStatus" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'full',
    "plexRatingKey" TEXT,
    "librarySectionKey" TEXT,
    "tmdbId" INTEGER,
    "tvdbId" INTEGER,
    "arrInstanceId" TEXT,
    "arrId" INTEGER,
    "monitored" BOOLEAN,
    "rootFolderPath" TEXT,
    "path" TEXT,
    "addedAt" DATETIME,
    "lastWatchedAt" DATETIME,
    "rating" REAL,
    "reasonsJson" JSONB,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "pruneStatus" TEXT NOT NULL DEFAULT 'pending',
    "pruneError" TEXT,
    "prunedAt" DATETIME,
    CONSTRAINT "CurationCandidate_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "CurationSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PruneRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "tmdbId" INTEGER,
    "tvdbId" INTEGER,
    "arrInstanceId" TEXT,
    "arrId" INTEGER,
    "plexRatingKey" TEXT,
    "rootFolderPath" TEXT,
    "snapshotId" TEXT,
    "runId" TEXT,
    "action" TEXT NOT NULL,
    "tagApplied" BOOLEAN NOT NULL DEFAULT false,
    "restoredAt" DATETIME,
    "restoreNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CurationSnapshot_userId_kind_createdAt_idx" ON "CurationSnapshot"("userId", "kind", "createdAt");

CREATE INDEX "CurationCandidate_snapshotId_selected_idx" ON "CurationCandidate"("snapshotId", "selected");

CREATE INDEX "CurationCandidate_snapshotId_tier_score_idx" ON "CurationCandidate"("snapshotId", "tier", "score");

CREATE INDEX "CurationCandidate_snapshotId_rootFolderPath_idx" ON "CurationCandidate"("snapshotId", "rootFolderPath");

CREATE INDEX "CurationCandidate_snapshotId_sizeBytes_idx" ON "CurationCandidate"("snapshotId", "sizeBytes");

CREATE INDEX "PruneRecord_userId_createdAt_idx" ON "PruneRecord"("userId", "createdAt");

CREATE INDEX "PruneRecord_userId_restoredAt_idx" ON "PruneRecord"("userId", "restoredAt");

CREATE INDEX "PruneRecord_tmdbId_idx" ON "PruneRecord"("tmdbId");

CREATE INDEX "PruneRecord_tvdbId_idx" ON "PruneRecord"("tvdbId");
