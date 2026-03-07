-- AlterTable
ALTER TABLE "ImmaculateTasteProfile"
ADD COLUMN "excludedGenres" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "ImmaculateTasteProfile"
ADD COLUMN "excludedAudioLanguages" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "ImmaculateTasteProfileUserOverride"
ADD COLUMN "excludedGenres" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "ImmaculateTasteProfileUserOverride"
ADD COLUMN "excludedAudioLanguages" TEXT NOT NULL DEFAULT '[]';
