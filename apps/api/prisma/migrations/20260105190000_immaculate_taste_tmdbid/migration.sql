-- Migrate ImmaculateTasteMovie from Plex ratingKey PK to TMDB-id PK.
-- Preserve the old table for reference/debugging.

DROP INDEX IF EXISTS "ImmaculateTasteMovie_points_idx";

ALTER TABLE "ImmaculateTasteMovie" RENAME TO "ImmaculateTasteMovieLegacy";

CREATE TABLE "ImmaculateTasteMovie" (
    "tmdbId" INTEGER NOT NULL PRIMARY KEY,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tmdbVoteAvg" REAL,
    "tmdbVoteCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "ImmaculateTasteMovie" (
    "tmdbId",
    "title",
    "status",
    "points",
    "tmdbVoteAvg",
    "tmdbVoteCount",
    "createdAt",
    "updatedAt"
)
SELECT
    "tmdbId" AS "tmdbId",
    MAX("title") AS "title",
    'active' AS "status",
    MAX("points") AS "points",
    NULL AS "tmdbVoteAvg",
    NULL AS "tmdbVoteCount",
    MIN("createdAt") AS "createdAt",
    MAX("updatedAt") AS "updatedAt"
FROM "ImmaculateTasteMovieLegacy"
WHERE "tmdbId" IS NOT NULL
GROUP BY "tmdbId";

CREATE INDEX "ImmaculateTasteMovie_status_idx" ON "ImmaculateTasteMovie"("status");
CREATE INDEX "ImmaculateTasteMovie_points_idx" ON "ImmaculateTasteMovie"("points");
CREATE INDEX "ImmaculateTasteMovie_tmdbVoteAvg_idx" ON "ImmaculateTasteMovie"("tmdbVoteAvg");




