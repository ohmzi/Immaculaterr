CREATE TABLE "UserRecovery" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "questionOneKey" TEXT NOT NULL,
    "questionOneAnswerHash" TEXT NOT NULL,
    "questionTwoKey" TEXT NOT NULL,
    "questionTwoAnswerHash" TEXT NOT NULL,
    "questionThreeKey" TEXT NOT NULL,
    "questionThreeAnswerHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserRecovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
