-- CreateTable
CREATE TABLE "CuratedCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CuratedCollectionItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "collectionId" TEXT NOT NULL,
    "ratingKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    CONSTRAINT "CuratedCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CuratedCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CuratedCollection_name_key" ON "CuratedCollection"("name");

-- CreateIndex
CREATE INDEX "CuratedCollectionItem_collectionId_idx" ON "CuratedCollectionItem"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CuratedCollectionItem_collectionId_ratingKey_key" ON "CuratedCollectionItem"("collectionId", "ratingKey");
