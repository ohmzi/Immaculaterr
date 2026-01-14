-- CreateTable
CREATE TABLE "RejectedSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "externalSource" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RejectedSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RejectedSuggestion_userId_mediaType_idx" ON "RejectedSuggestion"("userId", "mediaType");

-- CreateIndex
CREATE UNIQUE INDEX "RejectedSuggestion_userId_mediaType_externalSource_externalId_key" ON "RejectedSuggestion"("userId", "mediaType", "externalSource", "externalId");
