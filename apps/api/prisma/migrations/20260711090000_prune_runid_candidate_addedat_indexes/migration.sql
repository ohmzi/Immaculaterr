-- Additive indexes:
--  * PruneRecord (userId, runId): run-scoped prune lookups (undo toast,
--    run-detail views) previously row-scanned within (userId, createdAt).
--  * CuttingRoomCandidate (snapshotId, addedAt): the addedAt sort option.
CREATE INDEX "PruneRecord_userId_runId_idx" ON "PruneRecord"("userId", "runId");
CREATE INDEX "CuttingRoomCandidate_snapshotId_addedAt_idx" ON "CuttingRoomCandidate"("snapshotId", "addedAt");
