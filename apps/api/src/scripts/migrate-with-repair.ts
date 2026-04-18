import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const TARGET_MIGRATION = '20260224090000_auth_security_hardening';
const CREATE_TASTE_PROFILES_MIGRATION =
  '20260310120000_create_immaculate_taste_profiles';
const IMMACULATE_TASTE_SCOPE_ALL_USERS_MIGRATION =
  '20260316200000_add_scope_all_users_to_taste_profile';
const FRESH_RELEASE_CACHE_MIGRATION =
  '20260317120000_fresh_out_of_the_oven_recent_release_cache';
const IMPORTED_WATCH_ENTRY_MIGRATION =
  '20260405092958_add_imported_watch_entry';
const AUTO_RUN_MEDIA_HISTORY_MIGRATION =
  '20260411120000_add_auto_run_media_history';
const FRESH_RELEASE_SHOW_LIBRARY_MIGRATION =
  '20260413120000_add_fresh_release_show_library';
const PRISMA_BIN_CANDIDATES = [
  './apps/api/node_modules/.bin/prisma',
  './node_modules/.bin/prisma',
];
const PRISMA_SCHEMA_CANDIDATES = [
  'apps/api/prisma/schema.prisma',
  'prisma/schema.prisma',
];
const MIGRATION_STATUS_QUERY = [
  'SELECT "finished_at", "rolled_back_at"',
  '   FROM "_prisma_migrations"',
  '  WHERE "migration_name" = ?',
  '  ORDER BY "started_at" DESC',
  '  LIMIT 1',
].join('\n');
const FAILED_MIGRATIONS_QUERY = [
  'SELECT "migration_name", "started_at"',
  '   FROM "_prisma_migrations"',
  '  WHERE "finished_at" IS NULL',
  '    AND "rolled_back_at" IS NULL',
  '  ORDER BY "started_at" DESC',
].join('\n');
const NORMALIZE_LEGACY_SESSION_TIMESTAMPS_SQL = [
  'UPDATE "Session"',
  '   SET "lastSeenAt" = datetime(CAST("lastSeenAt" AS INTEGER) / 1000, \'unixepoch\')',
  ' WHERE "lastSeenAt" IS NOT NULL',
  '   AND CAST("lastSeenAt" AS TEXT) != \'\'',
  '   AND CAST("lastSeenAt" AS TEXT) NOT GLOB \'*[^0-9]*\'',
].join('\n');
const CREATE_NEW_SESSION_TABLE_SQL = [
  'CREATE TABLE "new_Session" (',
  '  "id" TEXT NOT NULL PRIMARY KEY,',
  '  "userId" TEXT NOT NULL,',
  '  "tokenVersion" INTEGER NOT NULL,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "lastSeenAt" DATETIME NOT NULL,',
  '  "expiresAt" DATETIME NOT NULL,',
  '  CONSTRAINT "Session_userId_fkey"',
  '    FOREIGN KEY ("userId") REFERENCES "User" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE',
  ')',
].join('\n');
const COPY_SESSION_ROWS_SQL = [
  'INSERT INTO "new_Session" ("id", "userId", "tokenVersion", "createdAt", "lastSeenAt", "expiresAt")',
  'SELECT',
  '  s."id",',
  '  s."userId",',
  '  COALESCE(u."tokenVersion", 0),',
  '  s."createdAt",',
  '  CASE',
  "    WHEN typeof(s.\"lastSeenAt\") IN ('integer', 'real') THEN datetime(CAST(s.\"lastSeenAt\" AS INTEGER) / 1000, 'unixepoch')",
  '    WHEN CAST(s."lastSeenAt" AS TEXT) != \'\' AND CAST(s."lastSeenAt" AS TEXT) NOT GLOB \'*[^0-9]*\' THEN datetime(CAST(s."lastSeenAt" AS INTEGER) / 1000, \'unixepoch\')',
  '    WHEN datetime(s."lastSeenAt") IS NOT NULL THEN datetime(s."lastSeenAt")',
  '    ELSE CURRENT_TIMESTAMP',
  '  END,',
  '  CASE',
  "    WHEN typeof(s.\"lastSeenAt\") IN ('integer', 'real') THEN datetime(CAST(s.\"lastSeenAt\" AS INTEGER) / 1000, 'unixepoch', '+1 day')",
  "    WHEN CAST(s.\"lastSeenAt\" AS TEXT) != '' AND CAST(s.\"lastSeenAt\" AS TEXT) NOT GLOB '*[^0-9]*' THEN datetime(CAST(s.\"lastSeenAt\" AS INTEGER) / 1000, 'unixepoch', '+1 day')",
  '    WHEN datetime(s."lastSeenAt") IS NOT NULL THEN datetime(s."lastSeenAt", \'+1 day\')',
  "    ELSE datetime(CURRENT_TIMESTAMP, '+1 day')",
  '  END',
  'FROM "Session" s',
  'LEFT JOIN "User" u ON u."id" = s."userId"',
].join('\n');
const CREATE_ARR_INSTANCE_TABLE_SQL = [
  'CREATE TABLE "ArrInstance" (',
  '  "id" TEXT NOT NULL PRIMARY KEY,',
  '  "userId" TEXT NOT NULL,',
  '  "type" TEXT NOT NULL,',
  '  "name" TEXT NOT NULL,',
  '  "baseUrl" TEXT NOT NULL,',
  '  "apiKey" TEXT NOT NULL,',
  '  "enabled" BOOLEAN NOT NULL DEFAULT true,',
  '  "sortOrder" INTEGER NOT NULL DEFAULT 0,',
  '  "rootFolderPath" TEXT,',
  '  "qualityProfileId" INTEGER,',
  '  "tagId" INTEGER,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "updatedAt" DATETIME NOT NULL,',
  '  CONSTRAINT "ArrInstance_userId_fkey"',
  '    FOREIGN KEY ("userId") REFERENCES "User" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE',
  ')',
].join('\n');
const ADD_ARR_INSTANCE_ENABLED_COLUMN_SQL =
  'ALTER TABLE "ArrInstance" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true';
const ADD_ARR_INSTANCE_SORT_ORDER_COLUMN_SQL =
  'ALTER TABLE "ArrInstance" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0';
const ADD_ARR_INSTANCE_ROOT_FOLDER_PATH_COLUMN_SQL =
  'ALTER TABLE "ArrInstance" ADD COLUMN "rootFolderPath" TEXT';
const ADD_ARR_INSTANCE_QUALITY_PROFILE_ID_COLUMN_SQL =
  'ALTER TABLE "ArrInstance" ADD COLUMN "qualityProfileId" INTEGER';
const ADD_ARR_INSTANCE_TAG_ID_COLUMN_SQL =
  'ALTER TABLE "ArrInstance" ADD COLUMN "tagId" INTEGER';
const CREATE_ARR_INSTANCE_TYPE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ArrInstance_userId_type_idx" ON "ArrInstance"("userId", "type")';
const CREATE_ARR_INSTANCE_UNIQUE_NAME_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS "ArrInstance_userId_type_name_key" ON "ArrInstance"("userId", "type", "name")';
const CREATE_IMPORTED_WATCH_ENTRY_TABLE_SQL = [
  'CREATE TABLE "ImportedWatchEntry" (',
  '  "id" TEXT NOT NULL PRIMARY KEY,',
  '  "userId" TEXT NOT NULL,',
  '  "source" TEXT NOT NULL,',
  '  "rawTitle" TEXT NOT NULL,',
  '  "parsedTitle" TEXT NOT NULL,',
  '  "watchedAt" DATETIME,',
  '  "mediaType" TEXT,',
  '  "tmdbId" INTEGER,',
  '  "tvdbId" INTEGER,',
  '  "matchedTitle" TEXT,',
  '  "status" TEXT NOT NULL DEFAULT \'pending\',',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "updatedAt" DATETIME NOT NULL,',
  '  CONSTRAINT "ImportedWatchEntry_userId_fkey"',
  '    FOREIGN KEY ("userId") REFERENCES "User" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE',
  ')',
].join('\n');
const CREATE_IMPORTED_WATCH_ENTRY_SOURCE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImportedWatchEntry_userId_source_idx" ON "ImportedWatchEntry"("userId", "source")';
const CREATE_IMPORTED_WATCH_ENTRY_STATUS_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImportedWatchEntry_userId_status_idx" ON "ImportedWatchEntry"("userId", "status")';
const CREATE_IMPORTED_WATCH_ENTRY_UNIQUE_PARSED_TITLE_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS "ImportedWatchEntry_userId_source_parsedTitle_key" ON "ImportedWatchEntry"("userId", "source", "parsedTitle")';
const CREATE_AUTO_RUN_MEDIA_HISTORY_TABLE_SQL = [
  'CREATE TABLE "AutoRunMediaHistory" (',
  '  "id" TEXT NOT NULL PRIMARY KEY,',
  '  "jobId" TEXT NOT NULL,',
  '  "mediaFingerprint" TEXT NOT NULL,',
  '  "plexUserId" TEXT NOT NULL,',
  '  "mediaType" TEXT NOT NULL,',
  '  "librarySectionKey" TEXT NOT NULL,',
  '  "seedRatingKey" TEXT,',
  '  "showRatingKey" TEXT,',
  '  "seedTitle" TEXT,',
  '  "seedYear" INTEGER,',
  '  "seasonNumber" INTEGER,',
  '  "episodeNumber" INTEGER,',
  '  "source" TEXT NOT NULL,',
  '  "firstRunId" TEXT NOT NULL,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ')',
].join('\n');
const CREATE_AUTO_RUN_MEDIA_HISTORY_UNIQUE_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS "AutoRunMediaHistory_jobId_mediaFingerprint_key" ON "AutoRunMediaHistory"("jobId", "mediaFingerprint")';
const CREATE_AUTO_RUN_MEDIA_HISTORY_LOOKUP_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "AutoRunMediaHistory_jobId_plexUserId_librarySectionKey_createdAt_idx" ON "AutoRunMediaHistory"("jobId", "plexUserId", "librarySectionKey", "createdAt")';
const CREATE_IMMACULATE_TASTE_PROFILE_TABLE_SQL = [
  'CREATE TABLE "ImmaculateTasteProfile" (',
  '  "id" TEXT NOT NULL PRIMARY KEY,',
  '  "userId" TEXT NOT NULL,',
  '  "name" TEXT NOT NULL,',
  '  "isDefault" BOOLEAN NOT NULL DEFAULT false,',
  '  "enabled" BOOLEAN NOT NULL DEFAULT true,',
  '  "sortOrder" INTEGER NOT NULL DEFAULT 0,',
  '  "mediaType" TEXT NOT NULL DEFAULT \'both\',',
  '  "matchMode" TEXT NOT NULL DEFAULT \'all\',',
  '  "genres" TEXT NOT NULL DEFAULT \'[]\',',
  '  "audioLanguages" TEXT NOT NULL DEFAULT \'[]\',',
  '  "excludedGenres" TEXT NOT NULL DEFAULT \'[]\',',
  '  "excludedAudioLanguages" TEXT NOT NULL DEFAULT \'[]\',',
  '  "radarrInstanceId" TEXT,',
  '  "sonarrInstanceId" TEXT,',
  '  "movieCollectionBaseName" TEXT,',
  '  "showCollectionBaseName" TEXT,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "updatedAt" DATETIME NOT NULL,',
  '  CONSTRAINT "ImmaculateTasteProfile_userId_fkey"',
  '    FOREIGN KEY ("userId") REFERENCES "User" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE',
  ')',
].join('\n');
const ADD_IMMACULATE_TASTE_PROFILE_RADARR_INSTANCE_ID_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteProfile" ADD COLUMN "radarrInstanceId" TEXT';
const ADD_IMMACULATE_TASTE_PROFILE_SONARR_INSTANCE_ID_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteProfile" ADD COLUMN "sonarrInstanceId" TEXT';
const CREATE_IMMACULATE_TASTE_PROFILE_USER_ENABLED_SORT_ORDER_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteProfile_userId_enabled_sortOrder_idx" ON "ImmaculateTasteProfile"("userId", "enabled", "sortOrder")';
const CREATE_IMMACULATE_TASTE_PROFILE_USER_NAME_UNIQUE_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS "ImmaculateTasteProfile_userId_name_key" ON "ImmaculateTasteProfile"("userId", "name")';
const CREATE_IMMACULATE_TASTE_PROFILE_USER_OVERRIDE_TABLE_SQL = [
  'CREATE TABLE "ImmaculateTasteProfileUserOverride" (',
  '  "id" TEXT NOT NULL PRIMARY KEY,',
  '  "profileId" TEXT NOT NULL,',
  '  "plexUserId" TEXT NOT NULL,',
  '  "mediaType" TEXT NOT NULL DEFAULT \'both\',',
  '  "matchMode" TEXT NOT NULL DEFAULT \'all\',',
  '  "genres" TEXT NOT NULL DEFAULT \'[]\',',
  '  "audioLanguages" TEXT NOT NULL DEFAULT \'[]\',',
  '  "excludedGenres" TEXT NOT NULL DEFAULT \'[]\',',
  '  "excludedAudioLanguages" TEXT NOT NULL DEFAULT \'[]\',',
  '  "radarrInstanceId" TEXT,',
  '  "sonarrInstanceId" TEXT,',
  '  "movieCollectionBaseName" TEXT,',
  '  "showCollectionBaseName" TEXT,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "updatedAt" DATETIME NOT NULL,',
  '  CONSTRAINT "ImmaculateTasteProfileUserOverride_profileId_fkey"',
  '    FOREIGN KEY ("profileId") REFERENCES "ImmaculateTasteProfile" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE,',
  '  CONSTRAINT "ImmaculateTasteProfileUserOverride_plexUserId_fkey"',
  '    FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE',
  ')',
].join('\n');
const ADD_IMMACULATE_TASTE_PROFILE_EXCLUDED_GENRES_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteProfile" ADD COLUMN "excludedGenres" TEXT NOT NULL DEFAULT \'[]\'';
const ADD_IMMACULATE_TASTE_PROFILE_EXCLUDED_AUDIO_LANGUAGES_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteProfile" ADD COLUMN "excludedAudioLanguages" TEXT NOT NULL DEFAULT \'[]\'';
const ADD_IMMACULATE_TASTE_PROFILE_SCOPE_ALL_USERS_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteProfile" ADD COLUMN "scopeAllUsers" BOOLEAN NOT NULL DEFAULT true';
const ADD_IMMACULATE_TASTE_PROFILE_OVERRIDE_RADARR_INSTANCE_ID_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteProfileUserOverride" ADD COLUMN "radarrInstanceId" TEXT';
const ADD_IMMACULATE_TASTE_PROFILE_OVERRIDE_SONARR_INSTANCE_ID_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteProfileUserOverride" ADD COLUMN "sonarrInstanceId" TEXT';
const ADD_IMMACULATE_TASTE_PROFILE_OVERRIDE_EXCLUDED_GENRES_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteProfileUserOverride" ADD COLUMN "excludedGenres" TEXT NOT NULL DEFAULT \'[]\'';
const ADD_IMMACULATE_TASTE_PROFILE_OVERRIDE_EXCLUDED_AUDIO_LANGUAGES_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteProfileUserOverride" ADD COLUMN "excludedAudioLanguages" TEXT NOT NULL DEFAULT \'[]\'';
const CREATE_IMMACULATE_TASTE_PROFILE_OVERRIDE_UNIQUE_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS "ImmaculateTasteProfileUserOverride_profileId_plexUserId_key" ON "ImmaculateTasteProfileUserOverride"("profileId", "plexUserId")';
const CREATE_IMMACULATE_TASTE_PROFILE_OVERRIDE_PROFILE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteProfileUserOverride_profileId_idx" ON "ImmaculateTasteProfileUserOverride"("profileId")';
const CREATE_IMMACULATE_TASTE_PROFILE_OVERRIDE_PLEX_USER_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteProfileUserOverride_plexUserId_idx" ON "ImmaculateTasteProfileUserOverride"("plexUserId")';
const CREATE_NEW_IMMACULATE_TASTE_MOVIE_LIBRARY_TABLE_SQL = [
  'CREATE TABLE "new_ImmaculateTasteMovieLibrary" (',
  '  "plexUserId" TEXT NOT NULL,',
  '  "librarySectionKey" TEXT NOT NULL,',
  '  "profileId" TEXT NOT NULL DEFAULT \'default\',',
  '  "tmdbId" INTEGER NOT NULL,',
  '  "title" TEXT,',
  '  "status" TEXT NOT NULL DEFAULT \'pending\',',
  '  "points" INTEGER NOT NULL DEFAULT 0,',
  '  "tmdbVoteAvg" REAL,',
  '  "tmdbVoteCount" INTEGER,',
  '  "releaseDate" DATETIME,',
  '  "downloadApproval" TEXT NOT NULL DEFAULT \'none\',',
  '  "sentToRadarrAt" DATETIME,',
  '  "sentToSonarrAt" DATETIME,',
  '  "tmdbPosterPath" TEXT,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "updatedAt" DATETIME NOT NULL,',
  '  PRIMARY KEY ("plexUserId", "librarySectionKey", "profileId", "tmdbId"),',
  '  CONSTRAINT "ImmaculateTasteMovieLibrary_plexUserId_fkey"',
  '    FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE',
  ')',
].join('\n');
const COPY_IMMACULATE_TASTE_MOVIE_LIBRARY_ROWS_SQL = [
  'INSERT INTO "new_ImmaculateTasteMovieLibrary" (',
  '  "plexUserId", "librarySectionKey", "profileId", "tmdbId", "title",',
  '  "status", "points", "tmdbVoteAvg", "tmdbVoteCount",',
  '  "downloadApproval", "sentToRadarrAt", "sentToSonarrAt", "tmdbPosterPath",',
  '  "createdAt", "updatedAt"',
  ')',
  'SELECT',
  '  "plexUserId", "librarySectionKey", \'default\', "tmdbId", "title",',
  '  "status", "points", "tmdbVoteAvg", "tmdbVoteCount",',
  '  "downloadApproval", "sentToRadarrAt", "sentToSonarrAt", "tmdbPosterPath",',
  '  "createdAt", "updatedAt"',
  'FROM "ImmaculateTasteMovieLibrary"',
].join('\n');
const CREATE_NEW_IMMACULATE_TASTE_SHOW_LIBRARY_TABLE_SQL = [
  'CREATE TABLE "new_ImmaculateTasteShowLibrary" (',
  '  "plexUserId" TEXT NOT NULL,',
  '  "librarySectionKey" TEXT NOT NULL,',
  '  "profileId" TEXT NOT NULL DEFAULT \'default\',',
  '  "tvdbId" INTEGER NOT NULL,',
  '  "tmdbId" INTEGER,',
  '  "title" TEXT,',
  '  "status" TEXT NOT NULL DEFAULT \'pending\',',
  '  "points" INTEGER NOT NULL DEFAULT 0,',
  '  "tmdbVoteAvg" REAL,',
  '  "tmdbVoteCount" INTEGER,',
  '  "firstAirDate" DATETIME,',
  '  "downloadApproval" TEXT NOT NULL DEFAULT \'none\',',
  '  "sentToRadarrAt" DATETIME,',
  '  "sentToSonarrAt" DATETIME,',
  '  "tmdbPosterPath" TEXT,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "updatedAt" DATETIME NOT NULL,',
  '  PRIMARY KEY ("plexUserId", "librarySectionKey", "profileId", "tvdbId"),',
  '  CONSTRAINT "ImmaculateTasteShowLibrary_plexUserId_fkey"',
  '    FOREIGN KEY ("plexUserId") REFERENCES "PlexUser" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE',
  ')',
].join('\n');
const COPY_IMMACULATE_TASTE_SHOW_LIBRARY_ROWS_SQL = [
  'INSERT INTO "new_ImmaculateTasteShowLibrary" (',
  '  "plexUserId", "librarySectionKey", "profileId", "tvdbId", "tmdbId", "title",',
  '  "status", "points", "tmdbVoteAvg", "tmdbVoteCount",',
  '  "downloadApproval", "sentToRadarrAt", "sentToSonarrAt", "tmdbPosterPath",',
  '  "createdAt", "updatedAt"',
  ')',
  'SELECT',
  '  "plexUserId", "librarySectionKey", \'default\', "tvdbId", "tmdbId", "title",',
  '  "status", "points", "tmdbVoteAvg", "tmdbVoteCount",',
  '  "downloadApproval", "sentToRadarrAt", "sentToSonarrAt", "tmdbPosterPath",',
  '  "createdAt", "updatedAt"',
  'FROM "ImmaculateTasteShowLibrary"',
].join('\n');
const CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_PLEX_USER_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteMovieLibrary_plexUserId_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId")';
const CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_SECTION_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey")';
const CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_PROFILE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteMovieLibrary_profileId_idx" ON "ImmaculateTasteMovieLibrary"("profileId")';
const CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_STATUS_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_status_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey", "status")';
const CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_POINTS_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_points_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey", "points")';
const CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_VOTE_AVG_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteMovieLibrary_plexUserId_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteMovieLibrary"("plexUserId", "librarySectionKey", "tmdbVoteAvg")';
const CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_PLEX_USER_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteShowLibrary_plexUserId_idx" ON "ImmaculateTasteShowLibrary"("plexUserId")';
const CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_SECTION_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey")';
const CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_PROFILE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteShowLibrary_profileId_idx" ON "ImmaculateTasteShowLibrary"("profileId")';
const CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_TMDB_ID_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteShowLibrary_plexUserId_tmdbId_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "tmdbId")';
const CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_STATUS_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_status_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey", "status")';
const CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_POINTS_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_points_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey", "points")';
const CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_VOTE_AVG_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteShowLibrary_plexUserId_librarySectionKey_tmdbVoteAvg_idx" ON "ImmaculateTasteShowLibrary"("plexUserId", "librarySectionKey", "tmdbVoteAvg")';
const CREATE_FRESH_RELEASE_MOVIE_LIBRARY_RELEASE_DATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "FreshReleaseMovieLibrary_librarySectionKey_releaseDate_idx" ON "FreshReleaseMovieLibrary"("librarySectionKey", "releaseDate")';
const CREATE_FRESH_RELEASE_MOVIE_LIBRARY_LAST_CHECKED_AT_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "FreshReleaseMovieLibrary_librarySectionKey_lastCheckedAt_idx" ON "FreshReleaseMovieLibrary"("librarySectionKey", "lastCheckedAt")';
const CREATE_FRESH_RELEASE_SHOW_LIBRARY_FIRST_AIR_DATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "FreshReleaseShowLibrary_librarySectionKey_firstAirDate_idx" ON "FreshReleaseShowLibrary"("librarySectionKey", "firstAirDate")';
const CREATE_FRESH_RELEASE_SHOW_LIBRARY_LAST_CHECKED_AT_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "FreshReleaseShowLibrary_librarySectionKey_lastCheckedAt_idx" ON "FreshReleaseShowLibrary"("librarySectionKey", "lastCheckedAt")';
const CREATE_FRESH_RELEASE_SHOW_LIBRARY_TABLE_SQL = [
  'CREATE TABLE "FreshReleaseShowLibrary" (',
  '  "librarySectionKey" TEXT NOT NULL,',
  '  "tvdbId" INTEGER NOT NULL,',
  '  "tmdbId" INTEGER NOT NULL,',
  '  "title" TEXT,',
  '  "firstAirDate" DATETIME,',
  '  "tmdbPosterPath" TEXT,',
  '  "tmdbVoteAvg" REAL,',
  '  "tmdbVoteCount" INTEGER,',
  '  "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "updatedAt" DATETIME NOT NULL,',
  '  PRIMARY KEY ("librarySectionKey", "tvdbId")',
  ')',
].join('\n');
const ADD_WATCHED_MOVIE_RECOMMENDATION_LIBRARY_RELEASE_DATE_COLUMN_SQL =
  'ALTER TABLE "WatchedMovieRecommendationLibrary" ADD COLUMN "releaseDate" DATETIME';
const CREATE_WATCHED_MOVIE_RECOMMENDATION_LIBRARY_RELEASE_DATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "WatchedMovieRecommendationLibrary_releaseDate_idx" ON "WatchedMovieRecommendationLibrary"("releaseDate")';
const ADD_WATCHED_SHOW_RECOMMENDATION_LIBRARY_FIRST_AIR_DATE_COLUMN_SQL =
  'ALTER TABLE "WatchedShowRecommendationLibrary" ADD COLUMN "firstAirDate" DATETIME';
const CREATE_WATCHED_SHOW_RECOMMENDATION_LIBRARY_FIRST_AIR_DATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "WatchedShowRecommendationLibrary_firstAirDate_idx" ON "WatchedShowRecommendationLibrary"("firstAirDate")';
const ADD_IMMACULATE_TASTE_MOVIE_LIBRARY_RELEASE_DATE_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteMovieLibrary" ADD COLUMN "releaseDate" DATETIME';
const CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_RELEASE_DATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteMovieLibrary_releaseDate_idx" ON "ImmaculateTasteMovieLibrary"("releaseDate")';
const ADD_IMMACULATE_TASTE_SHOW_LIBRARY_FIRST_AIR_DATE_COLUMN_SQL =
  'ALTER TABLE "ImmaculateTasteShowLibrary" ADD COLUMN "firstAirDate" DATETIME';
const CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_FIRST_AIR_DATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "ImmaculateTasteShowLibrary_firstAirDate_idx" ON "ImmaculateTasteShowLibrary"("firstAirDate")';
const ADD_JOB_RUN_USER_ID_COLUMN_SQL =
  'ALTER TABLE "JobRun" ADD COLUMN "userId" TEXT';
const ADD_JOB_RUN_QUEUED_AT_COLUMN_SQL =
  'ALTER TABLE "JobRun" ADD COLUMN "queuedAt" DATETIME';
const ADD_JOB_RUN_EXECUTION_STARTED_AT_COLUMN_SQL =
  'ALTER TABLE "JobRun" ADD COLUMN "executionStartedAt" DATETIME';
const ADD_JOB_RUN_INPUT_COLUMN_SQL =
  'ALTER TABLE "JobRun" ADD COLUMN "input" JSONB';
const ADD_JOB_RUN_QUEUE_FINGERPRINT_COLUMN_SQL =
  'ALTER TABLE "JobRun" ADD COLUMN "queueFingerprint" TEXT';
const ADD_JOB_RUN_CLAIMED_AT_COLUMN_SQL =
  'ALTER TABLE "JobRun" ADD COLUMN "claimedAt" DATETIME';
const ADD_JOB_RUN_HEARTBEAT_AT_COLUMN_SQL =
  'ALTER TABLE "JobRun" ADD COLUMN "heartbeatAt" DATETIME';
const ADD_JOB_RUN_WORKER_ID_COLUMN_SQL =
  'ALTER TABLE "JobRun" ADD COLUMN "workerId" TEXT';
const BACKFILL_JOB_RUN_QUEUED_AT_SQL =
  'UPDATE "JobRun" SET "queuedAt" = "startedAt" WHERE "queuedAt" IS NULL';
const CREATE_JOB_RUN_USER_STARTED_AT_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "JobRun_userId_startedAt_idx" ON "JobRun"("userId", "startedAt")';
const CREATE_JOB_RUN_STATUS_QUEUED_AT_ID_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "JobRun_status_queuedAt_id_idx" ON "JobRun"("status", "queuedAt", "id")';
const CREATE_JOB_RUN_STATUS_EXECUTION_STARTED_AT_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "JobRun_status_executionStartedAt_idx" ON "JobRun"("status", "executionStartedAt")';
const CREATE_JOB_RUN_STATUS_QUEUE_FINGERPRINT_QUEUED_AT_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "JobRun_status_queueFingerprint_queuedAt_idx" ON "JobRun"("status", "queueFingerprint", "queuedAt")';
const CREATE_JOB_RUN_USER_STATUS_QUEUED_AT_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "JobRun_userId_status_queuedAt_idx" ON "JobRun"("userId", "status", "queuedAt")';
const CREATE_JOB_QUEUE_STATE_TABLE_SQL = [
  'CREATE TABLE "JobQueueState" (',
  '  "id" TEXT NOT NULL PRIMARY KEY,',
  '  "activeRunId" TEXT,',
  '  "cooldownUntil" DATETIME,',
  '  "paused" BOOLEAN NOT NULL DEFAULT false,',
  '  "pauseReason" TEXT,',
  '  "version" INTEGER NOT NULL DEFAULT 0,',
  '  "updatedAt" DATETIME NOT NULL',
  ')',
].join('\n');
const SEED_JOB_QUEUE_STATE_GLOBAL_ROW_SQL = [
  'INSERT OR IGNORE INTO "JobQueueState"',
  '  ("id", "activeRunId", "cooldownUntil", "paused", "pauseReason", "version", "updatedAt")',
  "VALUES ('global', NULL, NULL, false, NULL, 0, CURRENT_TIMESTAMP)",
].join('\n');
const ADD_REJECTED_SUGGESTION_COLLECTION_KIND_COLUMN_SQL =
  'ALTER TABLE "RejectedSuggestion" ADD COLUMN "collectionKind" TEXT';
const CREATE_REJECTED_SUGGESTION_USER_MEDIA_SOURCE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "RejectedSuggestion_userId_mediaType_source_idx" ON "RejectedSuggestion"("userId", "mediaType", "source")';
const CREATE_LOGIN_THROTTLE_TABLE_SQL = [
  'CREATE TABLE "LoginThrottle" (',
  '  "key" TEXT NOT NULL PRIMARY KEY,',
  '  "failures" INTEGER NOT NULL,',
  '  "firstFailureAt" DATETIME NOT NULL,',
  '  "lastFailureAt" DATETIME NOT NULL,',
  '  "lockUntil" DATETIME NOT NULL,',
  '  "updatedAt" DATETIME NOT NULL',
  ')',
].join('\n');
const CREATE_USER_RECOVERY_TABLE_SQL = [
  'CREATE TABLE "UserRecovery" (',
  '  "userId" TEXT NOT NULL PRIMARY KEY,',
  '  "questionOneKey" TEXT NOT NULL,',
  '  "questionOneAnswerHash" TEXT NOT NULL,',
  '  "questionTwoKey" TEXT NOT NULL,',
  '  "questionTwoAnswerHash" TEXT NOT NULL,',
  '  "questionThreeKey" TEXT NOT NULL,',
  '  "questionThreeAnswerHash" TEXT NOT NULL,',
  '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  "updatedAt" DATETIME NOT NULL,',
  '  CONSTRAINT "UserRecovery_userId_fkey"',
  '    FOREIGN KEY ("userId") REFERENCES "User" ("id")',
  '    ON DELETE CASCADE ON UPDATE CASCADE',
  ')',
].join('\n');

type TableInfoRow = {
  name: string;
};

type MigrationStatusRow = {
  finished_at: number | null;
  rolled_back_at: number | null;
};
type FailedMigrationRow = {
  migration_name: string;
  started_at: string | null;
};
type MigrationRecordState =
  | 'migrations_table_missing'
  | 'not_recorded'
  | 'applied'
  | 'failed'
  | 'rolled_back';
type SqliteMasterRow = {
  name: string;
};

function isMissingMigrationsTableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes('no such table: _prisma_migrations')
  );
}

function logRepair(message: string): void {
  console.log(`[migrate-with-repair] ${message}`);
}

function describeDatabaseTarget(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return 'DATABASE_URL is not set';
  return databaseUrl;
}

function resolveExistingPath(paths: string[], kind: string): string {
  const match = paths.find((candidate) => existsSync(candidate));
  if (match) return match;

  throw new Error(`Unable to locate ${kind}. Checked: ${paths.join(', ')}`);
}

function runPrisma(args: string[], label: string): void {
  const prismaBin = resolveExistingPath(PRISMA_BIN_CANDIDATES, 'Prisma CLI');
  const prismaSchema = resolveExistingPath(
    PRISMA_SCHEMA_CANDIDATES,
    'Prisma schema',
  );
  const result = spawnSync(prismaBin, [...args, '--schema', prismaSchema], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? 1})`);
  }
}

function hasColumn(rows: TableInfoRow[], column: string): boolean {
  return rows.some((row) => row.name === column);
}

async function tableInfo(
  prisma: PrismaClient,
  table: string,
): Promise<TableInfoRow[]> {
  return await prisma.$queryRawUnsafe<TableInfoRow[]>(
    `PRAGMA table_info("${table}")`,
  );
}

async function tableExists(
  prisma: PrismaClient,
  table: string,
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<SqliteMasterRow[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    table,
  );
  return rows.length > 0;
}

async function hasFailedTargetMigration(
  prisma: PrismaClient,
): Promise<boolean> {
  return (await migrationRecordState(prisma, TARGET_MIGRATION)) === 'failed';
}

async function migrationRecordState(
  prisma: PrismaClient,
  migrationName: string,
): Promise<MigrationRecordState> {
  let rows: MigrationStatusRow[];
  try {
    rows = await prisma.$queryRawUnsafe<MigrationStatusRow[]>(
      MIGRATION_STATUS_QUERY,
      migrationName,
    );
  } catch (err) {
    if (isMissingMigrationsTableError(err)) return 'migrations_table_missing';
    throw err;
  }

  if (rows.length === 0) return 'not_recorded';
  if (rows[0].finished_at != null) return 'applied';
  if (rows[0].rolled_back_at != null) return 'rolled_back';
  return 'failed';
}

async function failedMigrationRows(
  prisma: PrismaClient,
): Promise<FailedMigrationRow[]> {
  try {
    return await prisma.$queryRawUnsafe<FailedMigrationRow[]>(
      FAILED_MIGRATIONS_QUERY,
    );
  } catch (err) {
    if (isMissingMigrationsTableError(err)) return [];
    throw err;
  }
}

export async function logFailedMigrationDiagnostics(
  prisma: PrismaClient,
): Promise<void> {
  const rows = await failedMigrationRows(prisma);
  if (rows.length === 0) {
    logRepair(
      'No unresolved rows were found in _prisma_migrations after prisma migrate deploy failed.',
    );
    return;
  }

  const failedNames = rows.map((row) => row.migration_name).join(', ');
  console.error(
    `[migrate-with-repair] Failed Prisma migrations still blocking deploy: ${failedNames}`,
  );
  for (const row of rows) {
    const startedAt = row.started_at ? ` (started ${row.started_at})` : '';
    console.error(`[migrate-with-repair] - ${row.migration_name}${startedAt}`);
  }
  console.error(
    '[migrate-with-repair] No additional automatic repair is available for the remaining failed migrations. Inspect the schema state and use `prisma migrate resolve` manually if needed.',
  );
}

function resolveMigrationAsApplied(
  migrationName: string,
  reason?: string,
): void {
  const reasonSuffix = reason ? ` (${reason})` : '';
  logRepair(`Resolving migration as applied: ${migrationName}${reasonSuffix}`);
  runPrisma(
    ['migrate', 'resolve', '--applied', migrationName],
    `prisma migrate resolve --applied ${migrationName}`,
  );
}

function resolveMigrationAsRolledBack(
  migrationName: string,
  reason?: string,
): void {
  const reasonSuffix = reason ? ` (${reason})` : '';
  logRepair(
    `Resolving migration as rolled back: ${migrationName}${reasonSuffix}`,
  );
  runPrisma(
    ['migrate', 'resolve', '--rolled-back', migrationName],
    `prisma migrate resolve --rolled-back ${migrationName}`,
  );
}

async function normalizeLegacySessionTimestamps(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(NORMALIZE_LEGACY_SESSION_TIMESTAMPS_SQL);
}

async function repairPartialSessionSchema(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe('PRAGMA defer_foreign_keys=ON');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys=OFF');
  try {
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "new_Session"');
    await prisma.$executeRawUnsafe(CREATE_NEW_SESSION_TABLE_SQL);

    await prisma.$executeRawUnsafe(COPY_SESSION_ROWS_SQL);

    await prisma.$executeRawUnsafe('DROP TABLE "Session"');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "new_Session" RENAME TO "Session"',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId")',
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt")',
    );
  } finally {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON');
    await prisma.$executeRawUnsafe('PRAGMA defer_foreign_keys=OFF');
  }
}

function isSessionSchemaUpgraded(columns: TableInfoRow[]): boolean {
  return hasColumn(columns, 'tokenVersion') && hasColumn(columns, 'expiresAt');
}

function shouldRepairPartialSessionSchema(
  sessionColumns: TableInfoRow[],
  userColumns: TableInfoRow[],
): boolean {
  return (
    !isSessionSchemaUpgraded(sessionColumns) &&
    hasColumn(userColumns, 'tokenVersion')
  );
}

function resolveTargetMigrationState(sessionSchemaUpgraded: boolean): void {
  if (sessionSchemaUpgraded) {
    resolveMigrationAsApplied(
      TARGET_MIGRATION,
      'Session schema already reflects auth security hardening',
    );
    return;
  }

  resolveMigrationAsRolledBack(
    TARGET_MIGRATION,
    'Session schema still needs auth security hardening migration rerun',
  );
}

async function withSqliteForeignKeysDisabled(
  prisma: PrismaClient,
  run: () => Promise<void>,
): Promise<void> {
  await prisma.$executeRawUnsafe('PRAGMA defer_foreign_keys=ON');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys=OFF');
  try {
    await run();
  } finally {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON');
    await prisma.$executeRawUnsafe('PRAGMA defer_foreign_keys=OFF');
  }
}

async function repairFailedMigrationIfNeeded(
  prisma: PrismaClient,
): Promise<void> {
  const failedMigration = await hasFailedTargetMigration(prisma);
  if (!failedMigration) return;

  // Old installs stored Session.lastSeenAt as epoch milliseconds.
  // Normalize before retrying migration logic.
  await normalizeLegacySessionTimestamps(prisma);

  let sessionInfo = await tableInfo(prisma, 'Session');
  const userInfo = await tableInfo(prisma, 'User');

  if (shouldRepairPartialSessionSchema(sessionInfo, userInfo)) {
    await repairPartialSessionSchema(prisma);
    sessionInfo = await tableInfo(prisma, 'Session');
  }

  resolveTargetMigrationState(isSessionSchemaUpgraded(sessionInfo));
}

export async function repairMarch2026MigrationEdgeCases(
  prisma: PrismaClient,
): Promise<void> {
  // These repairs only apply to databases that already have core tables.
  if (!(await tableExists(prisma, 'User'))) return;

  const profileTableName = 'ImmaculateTasteProfile';
  const profileExistedBeforeRepair = await tableExists(
    prisma,
    profileTableName,
  );
  if (!profileExistedBeforeRepair) {
    await prisma.$executeRawUnsafe(CREATE_IMMACULATE_TASTE_PROFILE_TABLE_SQL);
    await prisma.$executeRawUnsafe(
      ADD_IMMACULATE_TASTE_PROFILE_SCOPE_ALL_USERS_COLUMN_SQL,
    );
  }

  const profileColumns = await tableInfo(prisma, profileTableName);
  const hasScopeAllUsers = hasColumn(profileColumns, 'scopeAllUsers');
  const scopeMigrationState = await migrationRecordState(
    prisma,
    IMMACULATE_TASTE_SCOPE_ALL_USERS_MIGRATION,
  );

  const createProfilesMigrationState = await migrationRecordState(
    prisma,
    CREATE_TASTE_PROFILES_MIGRATION,
  );
  if (
    createProfilesMigrationState === 'failed' ||
    (profileExistedBeforeRepair &&
      createProfilesMigrationState === 'not_recorded')
  ) {
    resolveMigrationAsApplied(
      CREATE_TASTE_PROFILES_MIGRATION,
      'ImmaculateTasteProfile already exists',
    );
  }

  if (hasScopeAllUsers) {
    if (
      scopeMigrationState !== 'applied' &&
      scopeMigrationState !== 'migrations_table_missing'
    ) {
      resolveMigrationAsApplied(
        IMMACULATE_TASTE_SCOPE_ALL_USERS_MIGRATION,
        'ImmaculateTasteProfile.scopeAllUsers already exists',
      );
    }
  } else if (
    scopeMigrationState === 'failed' ||
    scopeMigrationState === 'applied'
  ) {
    resolveMigrationAsRolledBack(
      IMMACULATE_TASTE_SCOPE_ALL_USERS_MIGRATION,
      'ImmaculateTasteProfile.scopeAllUsers is still missing',
    );
  }

  const freshReleaseTableName = 'FreshReleaseMovieLibrary';
  const freshReleaseTableExists = await tableExists(
    prisma,
    freshReleaseTableName,
  );
  const freshReleaseMigrationState = await migrationRecordState(
    prisma,
    FRESH_RELEASE_CACHE_MIGRATION,
  );

  if (freshReleaseTableExists) {
    if (
      freshReleaseMigrationState !== 'applied' &&
      freshReleaseMigrationState !== 'migrations_table_missing'
    ) {
      resolveMigrationAsApplied(
        FRESH_RELEASE_CACHE_MIGRATION,
        'FreshReleaseMovieLibrary already exists',
      );
    }
  } else if (
    freshReleaseMigrationState === 'failed' ||
    freshReleaseMigrationState === 'applied'
  ) {
    resolveMigrationAsRolledBack(
      FRESH_RELEASE_CACHE_MIGRATION,
      'FreshReleaseMovieLibrary is still missing',
    );
  }
}

export async function repairApril2026MigrationEdgeCases(
  prisma: PrismaClient,
): Promise<void> {
  if (!(await tableExists(prisma, 'User'))) return;

  const arrInstanceExists = await tableExists(prisma, 'ArrInstance');
  const importedWatchEntryExists = await tableExists(
    prisma,
    'ImportedWatchEntry',
  );
  const autoRunMediaHistoryExists = await tableExists(
    prisma,
    'AutoRunMediaHistory',
  );
  const freshReleaseShowLibraryExists = await tableExists(
    prisma,
    'FreshReleaseShowLibrary',
  );

  if (arrInstanceExists || importedWatchEntryExists) {
    await ensureImportedWatchEntrySchema(prisma);

    const importedWatchEntryMigrationState = await migrationRecordState(
      prisma,
      IMPORTED_WATCH_ENTRY_MIGRATION,
    );
    if (
      importedWatchEntryMigrationState !== 'applied' &&
      importedWatchEntryMigrationState !== 'migrations_table_missing'
    ) {
      resolveMigrationAsApplied(
        IMPORTED_WATCH_ENTRY_MIGRATION,
        importedWatchEntryExists
          ? 'ImportedWatchEntry already exists'
          : 'ArrInstance already exists; ImportedWatchEntry was provisioned by repair',
      );
    }
  }

  if (autoRunMediaHistoryExists) {
    await ensureAutoRunMediaHistorySchema(prisma);

    const autoRunMediaHistoryMigrationState = await migrationRecordState(
      prisma,
      AUTO_RUN_MEDIA_HISTORY_MIGRATION,
    );
    if (
      autoRunMediaHistoryMigrationState !== 'applied' &&
      autoRunMediaHistoryMigrationState !== 'migrations_table_missing'
    ) {
      resolveMigrationAsApplied(
        AUTO_RUN_MEDIA_HISTORY_MIGRATION,
        'AutoRunMediaHistory already exists',
      );
    }
  }

  const freshReleaseShowLibraryMigrationState = await migrationRecordState(
    prisma,
    FRESH_RELEASE_SHOW_LIBRARY_MIGRATION,
  );
  if (freshReleaseShowLibraryExists) {
    await ensureFreshReleaseShowLibrarySchema(prisma);
    if (
      freshReleaseShowLibraryMigrationState !== 'applied' &&
      freshReleaseShowLibraryMigrationState !== 'migrations_table_missing'
    ) {
      resolveMigrationAsApplied(
        FRESH_RELEASE_SHOW_LIBRARY_MIGRATION,
        'FreshReleaseShowLibrary already exists',
      );
    }
  } else if (
    freshReleaseShowLibraryMigrationState === 'failed' ||
    freshReleaseShowLibraryMigrationState === 'applied'
  ) {
    resolveMigrationAsRolledBack(
      FRESH_RELEASE_SHOW_LIBRARY_MIGRATION,
      'FreshReleaseShowLibrary is still missing',
    );
  }
}

async function ensureArrInstanceSchema(prisma: PrismaClient): Promise<void> {
  const tableName = 'ArrInstance';
  const exists = await tableExists(prisma, tableName);

  if (!exists) {
    await prisma.$executeRawUnsafe(CREATE_ARR_INSTANCE_TABLE_SQL);
  } else {
    const columns = await tableInfo(prisma, tableName);

    if (!hasColumn(columns, 'enabled')) {
      await prisma.$executeRawUnsafe(ADD_ARR_INSTANCE_ENABLED_COLUMN_SQL);
    }
    if (!hasColumn(columns, 'sortOrder')) {
      await prisma.$executeRawUnsafe(ADD_ARR_INSTANCE_SORT_ORDER_COLUMN_SQL);
    }
    if (!hasColumn(columns, 'rootFolderPath')) {
      await prisma.$executeRawUnsafe(
        ADD_ARR_INSTANCE_ROOT_FOLDER_PATH_COLUMN_SQL,
      );
    }
    if (!hasColumn(columns, 'qualityProfileId')) {
      await prisma.$executeRawUnsafe(
        ADD_ARR_INSTANCE_QUALITY_PROFILE_ID_COLUMN_SQL,
      );
    }
    if (!hasColumn(columns, 'tagId')) {
      await prisma.$executeRawUnsafe(ADD_ARR_INSTANCE_TAG_ID_COLUMN_SQL);
    }
  }

  await prisma.$executeRawUnsafe(CREATE_ARR_INSTANCE_TYPE_INDEX_SQL);
  await prisma.$executeRawUnsafe(CREATE_ARR_INSTANCE_UNIQUE_NAME_INDEX_SQL);
}

async function ensureImportedWatchEntrySchema(
  prisma: PrismaClient,
): Promise<void> {
  const tableName = 'ImportedWatchEntry';
  if (!(await tableExists(prisma, tableName))) {
    await prisma.$executeRawUnsafe(CREATE_IMPORTED_WATCH_ENTRY_TABLE_SQL);
  }

  await prisma.$executeRawUnsafe(CREATE_IMPORTED_WATCH_ENTRY_SOURCE_INDEX_SQL);
  await prisma.$executeRawUnsafe(CREATE_IMPORTED_WATCH_ENTRY_STATUS_INDEX_SQL);
  await prisma.$executeRawUnsafe(
    CREATE_IMPORTED_WATCH_ENTRY_UNIQUE_PARSED_TITLE_INDEX_SQL,
  );
}

async function ensureAutoRunMediaHistorySchema(
  prisma: PrismaClient,
): Promise<void> {
  const tableName = 'AutoRunMediaHistory';
  if (!(await tableExists(prisma, tableName))) {
    await prisma.$executeRawUnsafe(CREATE_AUTO_RUN_MEDIA_HISTORY_TABLE_SQL);
  }

  await prisma.$executeRawUnsafe(
    CREATE_AUTO_RUN_MEDIA_HISTORY_UNIQUE_INDEX_SQL,
  );
  await prisma.$executeRawUnsafe(
    CREATE_AUTO_RUN_MEDIA_HISTORY_LOOKUP_INDEX_SQL,
  );
}

async function rebuildImmaculateTasteMovieLibraryWithProfileId(
  prisma: PrismaClient,
): Promise<void> {
  await withSqliteForeignKeysDisabled(prisma, async () => {
    await prisma.$executeRawUnsafe(
      'DROP TABLE IF EXISTS "new_ImmaculateTasteMovieLibrary"',
    );
    await prisma.$executeRawUnsafe(
      CREATE_NEW_IMMACULATE_TASTE_MOVIE_LIBRARY_TABLE_SQL,
    );
    await prisma.$executeRawUnsafe(
      COPY_IMMACULATE_TASTE_MOVIE_LIBRARY_ROWS_SQL,
    );
    await prisma.$executeRawUnsafe('DROP TABLE "ImmaculateTasteMovieLibrary"');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "new_ImmaculateTasteMovieLibrary" RENAME TO "ImmaculateTasteMovieLibrary"',
    );
  });
}

async function rebuildImmaculateTasteShowLibraryWithProfileId(
  prisma: PrismaClient,
): Promise<void> {
  await withSqliteForeignKeysDisabled(prisma, async () => {
    await prisma.$executeRawUnsafe(
      'DROP TABLE IF EXISTS "new_ImmaculateTasteShowLibrary"',
    );
    await prisma.$executeRawUnsafe(
      CREATE_NEW_IMMACULATE_TASTE_SHOW_LIBRARY_TABLE_SQL,
    );
    await prisma.$executeRawUnsafe(COPY_IMMACULATE_TASTE_SHOW_LIBRARY_ROWS_SQL);
    await prisma.$executeRawUnsafe('DROP TABLE "ImmaculateTasteShowLibrary"');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "new_ImmaculateTasteShowLibrary" RENAME TO "ImmaculateTasteShowLibrary"',
    );
  });
}

async function ensureImmaculateTasteLibrarySchema(
  prisma: PrismaClient,
): Promise<void> {
  const movieTable = 'ImmaculateTasteMovieLibrary';
  if (await tableExists(prisma, movieTable)) {
    const movieColumns = await tableInfo(prisma, movieTable);
    if (!hasColumn(movieColumns, 'profileId')) {
      await rebuildImmaculateTasteMovieLibraryWithProfileId(prisma);
    }
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_PLEX_USER_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_SECTION_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_PROFILE_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_STATUS_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_POINTS_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_VOTE_AVG_INDEX_SQL,
    );
  }

  const showTable = 'ImmaculateTasteShowLibrary';
  if (await tableExists(prisma, showTable)) {
    const showColumns = await tableInfo(prisma, showTable);
    if (!hasColumn(showColumns, 'profileId')) {
      await rebuildImmaculateTasteShowLibraryWithProfileId(prisma);
    }
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_PLEX_USER_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_SECTION_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_PROFILE_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_TMDB_ID_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_STATUS_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_POINTS_INDEX_SQL,
    );
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_VOTE_AVG_INDEX_SQL,
    );
  }
}

async function ensureFreshReleaseMovieLibrarySchema(
  prisma: PrismaClient,
): Promise<void> {
  const tableName = 'FreshReleaseMovieLibrary';
  if (!(await tableExists(prisma, tableName))) return;

  await prisma.$executeRawUnsafe(
    CREATE_FRESH_RELEASE_MOVIE_LIBRARY_RELEASE_DATE_INDEX_SQL,
  );
  await prisma.$executeRawUnsafe(
    CREATE_FRESH_RELEASE_MOVIE_LIBRARY_LAST_CHECKED_AT_INDEX_SQL,
  );
}

async function ensureFreshReleaseShowLibrarySchema(
  prisma: PrismaClient,
): Promise<void> {
  const tableName = 'FreshReleaseShowLibrary';
  if (!(await tableExists(prisma, tableName))) {
    await prisma.$executeRawUnsafe(CREATE_FRESH_RELEASE_SHOW_LIBRARY_TABLE_SQL);
  }

  await prisma.$executeRawUnsafe(
    CREATE_FRESH_RELEASE_SHOW_LIBRARY_FIRST_AIR_DATE_INDEX_SQL,
  );
  await prisma.$executeRawUnsafe(
    CREATE_FRESH_RELEASE_SHOW_LIBRARY_LAST_CHECKED_AT_INDEX_SQL,
  );
}

async function ensureImmaculateTasteProfileSchema(
  prisma: PrismaClient,
): Promise<void> {
  const profileTableName = 'ImmaculateTasteProfile';
  const profileOverrideTableName = 'ImmaculateTasteProfileUserOverride';
  const profileExists = await tableExists(prisma, profileTableName);

  if (!profileExists) {
    await prisma.$executeRawUnsafe(CREATE_IMMACULATE_TASTE_PROFILE_TABLE_SQL);
  }

  const profileColumns = await tableInfo(prisma, profileTableName);

  if (!hasColumn(profileColumns, 'excludedGenres')) {
    await prisma.$executeRawUnsafe(
      ADD_IMMACULATE_TASTE_PROFILE_EXCLUDED_GENRES_COLUMN_SQL,
    );
  }

  if (!hasColumn(profileColumns, 'excludedAudioLanguages')) {
    await prisma.$executeRawUnsafe(
      ADD_IMMACULATE_TASTE_PROFILE_EXCLUDED_AUDIO_LANGUAGES_COLUMN_SQL,
    );
  }
  if (!hasColumn(profileColumns, 'scopeAllUsers')) {
    await prisma.$executeRawUnsafe(
      ADD_IMMACULATE_TASTE_PROFILE_SCOPE_ALL_USERS_COLUMN_SQL,
    );
  }
  if (!hasColumn(profileColumns, 'radarrInstanceId')) {
    await prisma.$executeRawUnsafe(
      ADD_IMMACULATE_TASTE_PROFILE_RADARR_INSTANCE_ID_COLUMN_SQL,
    );
  }
  if (!hasColumn(profileColumns, 'sonarrInstanceId')) {
    await prisma.$executeRawUnsafe(
      ADD_IMMACULATE_TASTE_PROFILE_SONARR_INSTANCE_ID_COLUMN_SQL,
    );
  }

  const profileOverrideExists = await tableExists(
    prisma,
    profileOverrideTableName,
  );

  if (!profileOverrideExists) {
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_PROFILE_USER_OVERRIDE_TABLE_SQL,
    );
  } else {
    const overrideColumns = await tableInfo(prisma, profileOverrideTableName);

    if (!hasColumn(overrideColumns, 'excludedGenres')) {
      await prisma.$executeRawUnsafe(
        ADD_IMMACULATE_TASTE_PROFILE_OVERRIDE_EXCLUDED_GENRES_COLUMN_SQL,
      );
    }

    if (!hasColumn(overrideColumns, 'excludedAudioLanguages')) {
      await prisma.$executeRawUnsafe(
        ADD_IMMACULATE_TASTE_PROFILE_OVERRIDE_EXCLUDED_AUDIO_LANGUAGES_COLUMN_SQL,
      );
    }
    if (!hasColumn(overrideColumns, 'radarrInstanceId')) {
      await prisma.$executeRawUnsafe(
        ADD_IMMACULATE_TASTE_PROFILE_OVERRIDE_RADARR_INSTANCE_ID_COLUMN_SQL,
      );
    }
    if (!hasColumn(overrideColumns, 'sonarrInstanceId')) {
      await prisma.$executeRawUnsafe(
        ADD_IMMACULATE_TASTE_PROFILE_OVERRIDE_SONARR_INSTANCE_ID_COLUMN_SQL,
      );
    }
  }

  await prisma.$executeRawUnsafe(
    CREATE_IMMACULATE_TASTE_PROFILE_USER_ENABLED_SORT_ORDER_INDEX_SQL,
  );
  await prisma.$executeRawUnsafe(
    CREATE_IMMACULATE_TASTE_PROFILE_USER_NAME_UNIQUE_INDEX_SQL,
  );
  await prisma.$executeRawUnsafe(
    CREATE_IMMACULATE_TASTE_PROFILE_OVERRIDE_UNIQUE_INDEX_SQL,
  );
  await prisma.$executeRawUnsafe(
    CREATE_IMMACULATE_TASTE_PROFILE_OVERRIDE_PROFILE_INDEX_SQL,
  );
  await prisma.$executeRawUnsafe(
    CREATE_IMMACULATE_TASTE_PROFILE_OVERRIDE_PLEX_USER_INDEX_SQL,
  );
}

export async function ensureJobRunSchema(prisma: PrismaClient): Promise<void> {
  const tableName = 'JobRun';
  if (!(await tableExists(prisma, tableName))) return;

  const columns = await tableInfo(prisma, tableName);
  if (!hasColumn(columns, 'userId')) {
    await prisma.$executeRawUnsafe(ADD_JOB_RUN_USER_ID_COLUMN_SQL);
  }
  if (!hasColumn(columns, 'queuedAt')) {
    await prisma.$executeRawUnsafe(ADD_JOB_RUN_QUEUED_AT_COLUMN_SQL);
    await prisma.$executeRawUnsafe(BACKFILL_JOB_RUN_QUEUED_AT_SQL);
  }
  if (!hasColumn(columns, 'executionStartedAt')) {
    await prisma.$executeRawUnsafe(ADD_JOB_RUN_EXECUTION_STARTED_AT_COLUMN_SQL);
  }
  if (!hasColumn(columns, 'input')) {
    await prisma.$executeRawUnsafe(ADD_JOB_RUN_INPUT_COLUMN_SQL);
  }
  if (!hasColumn(columns, 'queueFingerprint')) {
    await prisma.$executeRawUnsafe(ADD_JOB_RUN_QUEUE_FINGERPRINT_COLUMN_SQL);
  }
  if (!hasColumn(columns, 'claimedAt')) {
    await prisma.$executeRawUnsafe(ADD_JOB_RUN_CLAIMED_AT_COLUMN_SQL);
  }
  if (!hasColumn(columns, 'heartbeatAt')) {
    await prisma.$executeRawUnsafe(ADD_JOB_RUN_HEARTBEAT_AT_COLUMN_SQL);
  }
  if (!hasColumn(columns, 'workerId')) {
    await prisma.$executeRawUnsafe(ADD_JOB_RUN_WORKER_ID_COLUMN_SQL);
  }

  await prisma.$executeRawUnsafe(CREATE_JOB_RUN_USER_STARTED_AT_INDEX_SQL);
  await prisma.$executeRawUnsafe(CREATE_JOB_RUN_STATUS_QUEUED_AT_ID_INDEX_SQL);
  await prisma.$executeRawUnsafe(
    CREATE_JOB_RUN_STATUS_EXECUTION_STARTED_AT_INDEX_SQL,
  );
  await prisma.$executeRawUnsafe(
    CREATE_JOB_RUN_STATUS_QUEUE_FINGERPRINT_QUEUED_AT_INDEX_SQL,
  );
  await prisma.$executeRawUnsafe(
    CREATE_JOB_RUN_USER_STATUS_QUEUED_AT_INDEX_SQL,
  );
}

export async function ensureJobQueueStateSchema(
  prisma: PrismaClient,
): Promise<void> {
  const tableName = 'JobQueueState';
  if (!(await tableExists(prisma, tableName))) {
    await prisma.$executeRawUnsafe(CREATE_JOB_QUEUE_STATE_TABLE_SQL);
  }
  await prisma.$executeRawUnsafe(SEED_JOB_QUEUE_STATE_GLOBAL_ROW_SQL);
}

export async function ensureRejectedSuggestionSchema(
  prisma: PrismaClient,
): Promise<void> {
  const tableName = 'RejectedSuggestion';
  if (!(await tableExists(prisma, tableName))) return;

  const columns = await tableInfo(prisma, tableName);
  if (!hasColumn(columns, 'collectionKind')) {
    await prisma.$executeRawUnsafe(
      ADD_REJECTED_SUGGESTION_COLLECTION_KIND_COLUMN_SQL,
    );
  }
  await prisma.$executeRawUnsafe(
    CREATE_REJECTED_SUGGESTION_USER_MEDIA_SOURCE_INDEX_SQL,
  );
}

export async function ensureLoginThrottleSchema(
  prisma: PrismaClient,
): Promise<void> {
  const tableName = 'LoginThrottle';
  if (!(await tableExists(prisma, tableName))) {
    await prisma.$executeRawUnsafe(CREATE_LOGIN_THROTTLE_TABLE_SQL);
  }
}

export async function ensureUserRecoverySchema(
  prisma: PrismaClient,
): Promise<void> {
  if (!(await tableExists(prisma, 'User'))) return;

  const tableName = 'UserRecovery';
  if (!(await tableExists(prisma, tableName))) {
    await prisma.$executeRawUnsafe(CREATE_USER_RECOVERY_TABLE_SQL);
  }
}

export async function ensureImmaculateTasteLibraryReleaseDateColumns(
  prisma: PrismaClient,
): Promise<void> {
  const movieTable = 'ImmaculateTasteMovieLibrary';
  if (await tableExists(prisma, movieTable)) {
    const columns = await tableInfo(prisma, movieTable);
    if (!hasColumn(columns, 'releaseDate')) {
      await prisma.$executeRawUnsafe(
        ADD_IMMACULATE_TASTE_MOVIE_LIBRARY_RELEASE_DATE_COLUMN_SQL,
      );
    }
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_MOVIE_LIBRARY_RELEASE_DATE_INDEX_SQL,
    );
  }

  const showTable = 'ImmaculateTasteShowLibrary';
  if (await tableExists(prisma, showTable)) {
    const columns = await tableInfo(prisma, showTable);
    if (!hasColumn(columns, 'firstAirDate')) {
      await prisma.$executeRawUnsafe(
        ADD_IMMACULATE_TASTE_SHOW_LIBRARY_FIRST_AIR_DATE_COLUMN_SQL,
      );
    }
    await prisma.$executeRawUnsafe(
      CREATE_IMMACULATE_TASTE_SHOW_LIBRARY_FIRST_AIR_DATE_INDEX_SQL,
    );
  }
}

async function ensureWatchedRecommendationReleaseDateColumns(
  prisma: PrismaClient,
): Promise<void> {
  const movieTable = 'WatchedMovieRecommendationLibrary';
  if (await tableExists(prisma, movieTable)) {
    const columns = await tableInfo(prisma, movieTable);
    if (!hasColumn(columns, 'releaseDate')) {
      await prisma.$executeRawUnsafe(
        ADD_WATCHED_MOVIE_RECOMMENDATION_LIBRARY_RELEASE_DATE_COLUMN_SQL,
      );
    }
    await prisma.$executeRawUnsafe(
      CREATE_WATCHED_MOVIE_RECOMMENDATION_LIBRARY_RELEASE_DATE_INDEX_SQL,
    );
  }

  const showTable = 'WatchedShowRecommendationLibrary';
  if (await tableExists(prisma, showTable)) {
    const columns = await tableInfo(prisma, showTable);
    if (!hasColumn(columns, 'firstAirDate')) {
      await prisma.$executeRawUnsafe(
        ADD_WATCHED_SHOW_RECOMMENDATION_LIBRARY_FIRST_AIR_DATE_COLUMN_SQL,
      );
    }
    await prisma.$executeRawUnsafe(
      CREATE_WATCHED_SHOW_RECOMMENDATION_LIBRARY_FIRST_AIR_DATE_INDEX_SQL,
    );
  }
}

export async function main() {
  logRepair(`Using database target: ${describeDatabaseTarget()}`);
  const prisma = new PrismaClient();
  try {
    await repairFailedMigrationIfNeeded(prisma);
    await repairMarch2026MigrationEdgeCases(prisma);
    await repairApril2026MigrationEdgeCases(prisma);

    try {
      runPrisma(['migrate', 'deploy'], 'prisma migrate deploy');
    } catch (err) {
      await logFailedMigrationDiagnostics(prisma);
      throw err;
    }
    await ensureArrInstanceSchema(prisma);
    await ensureImportedWatchEntrySchema(prisma);
    await ensureAutoRunMediaHistorySchema(prisma);
    await ensureImmaculateTasteProfileSchema(prisma);
    await ensureImmaculateTasteLibrarySchema(prisma);
    await ensureImmaculateTasteLibraryReleaseDateColumns(prisma);
    await ensureFreshReleaseMovieLibrarySchema(prisma);
    await ensureFreshReleaseShowLibrarySchema(prisma);
    await ensureWatchedRecommendationReleaseDateColumns(prisma);
    await ensureJobRunSchema(prisma);
    await ensureJobQueueStateSchema(prisma);
    await ensureRejectedSuggestionSchema(prisma);
    await ensureLoginThrottleSchema(prisma);
    await ensureUserRecoverySchema(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((err) => {
    console.error(
      `[migrate-with-repair] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    process.exit(1);
  });
}
