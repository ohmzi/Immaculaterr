-- AlterTable
ALTER TABLE "RejectedSuggestion" ADD COLUMN "collectionKind" TEXT;

-- CreateIndex
CREATE INDEX "RejectedSuggestion_userId_mediaType_source_idx" ON "RejectedSuggestion"("userId", "mediaType", "source");
