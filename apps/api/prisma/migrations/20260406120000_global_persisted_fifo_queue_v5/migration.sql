-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN "queuedAt" DATETIME;
ALTER TABLE "JobRun" ADD COLUMN "executionStartedAt" DATETIME;
ALTER TABLE "JobRun" ADD COLUMN "input" JSONB;
ALTER TABLE "JobRun" ADD COLUMN "queueFingerprint" TEXT;
ALTER TABLE "JobRun" ADD COLUMN "claimedAt" DATETIME;
ALTER TABLE "JobRun" ADD COLUMN "heartbeatAt" DATETIME;
ALTER TABLE "JobRun" ADD COLUMN "workerId" TEXT;

UPDATE "JobRun"
SET "queuedAt" = "startedAt"
WHERE "queuedAt" IS NULL;

-- CreateTable
CREATE TABLE "JobQueueState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activeRunId" TEXT,
    "cooldownUntil" DATETIME,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pauseReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "JobQueueState" ("id", "activeRunId", "cooldownUntil", "paused", "pauseReason", "version", "updatedAt")
VALUES ('global', NULL, NULL, false, NULL, 0, CURRENT_TIMESTAMP);

-- CreateIndex
CREATE INDEX "JobRun_status_queuedAt_id_idx" ON "JobRun"("status", "queuedAt", "id");
CREATE INDEX "JobRun_status_executionStartedAt_idx" ON "JobRun"("status", "executionStartedAt");
CREATE INDEX "JobRun_status_queueFingerprint_queuedAt_idx" ON "JobRun"("status", "queueFingerprint", "queuedAt");
CREATE INDEX "JobRun_userId_status_queuedAt_idx" ON "JobRun"("userId", "status", "queuedAt");
