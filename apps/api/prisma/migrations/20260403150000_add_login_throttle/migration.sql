-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "failures" INTEGER NOT NULL,
    "firstFailureAt" DATETIME NOT NULL,
    "lastFailureAt" DATETIME NOT NULL,
    "lockUntil" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
