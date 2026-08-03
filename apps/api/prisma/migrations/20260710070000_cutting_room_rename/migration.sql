-- Rename Cutting Room tables (feature renamed from "Curation").
ALTER TABLE "CurationSnapshot" RENAME TO "CuttingRoomSnapshot";
ALTER TABLE "CurationCandidate" RENAME TO "CuttingRoomCandidate";

-- Recreate indexes under Prisma's naming convention for the new table names.
DROP INDEX IF EXISTS "CurationSnapshot_userId_kind_createdAt_idx";
CREATE INDEX "CuttingRoomSnapshot_userId_kind_createdAt_idx" ON "CuttingRoomSnapshot"("userId", "kind", "createdAt");
DROP INDEX IF EXISTS "CurationCandidate_snapshotId_selected_idx";
CREATE INDEX "CuttingRoomCandidate_snapshotId_selected_idx" ON "CuttingRoomCandidate"("snapshotId", "selected");
DROP INDEX IF EXISTS "CurationCandidate_snapshotId_tier_score_idx";
CREATE INDEX "CuttingRoomCandidate_snapshotId_tier_score_idx" ON "CuttingRoomCandidate"("snapshotId", "tier", "score");
DROP INDEX IF EXISTS "CurationCandidate_snapshotId_rootFolderPath_idx";
CREATE INDEX "CuttingRoomCandidate_snapshotId_rootFolderPath_idx" ON "CuttingRoomCandidate"("snapshotId", "rootFolderPath");
DROP INDEX IF EXISTS "CurationCandidate_snapshotId_sizeBytes_idx";
CREATE INDEX "CuttingRoomCandidate_snapshotId_sizeBytes_idx" ON "CuttingRoomCandidate"("snapshotId", "sizeBytes");

-- The weekly report job was removed with the rename; drop its schedule row.
DELETE FROM "JobSchedule" WHERE "jobId" IN ('curationReport', 'cuttingRoomReport');
