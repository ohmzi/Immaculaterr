import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { PlexServerService } from '../plex/plex-server.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { RadarrService, type RadarrMovie } from '../radarr/radarr.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { SettingsService } from '../settings/settings.service';
import { SonarrService, type SonarrSeries } from '../sonarr/sonarr.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { SeerrService } from '../seerr/seerr.service';
import { ImmaculateTasteCollectionService } from '../immaculate-taste-collection/immaculate-taste-collection.service';
import { ImmaculateTasteShowCollectionService } from '../immaculate-taste-collection/immaculate-taste-show-collection.service';
import { normalizeTitleForMatching } from '../lib/title-normalize';
import { resolvePlexLibrarySelection } from '../plex/plex-library-selection.utils';
import { isPlexUserExcludedFromMonitoring } from '../plex/plex-user-selection.utils';
import type {
  JobContext,
  JobRunResult,
  JsonObject,
  JsonValue,
} from './jobs.types';
import { ImmaculateTasteRefresherJob } from './immaculate-taste-refresher.job';
import type { JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';
import { withJobRetry, withJobRetryOrNull } from './job-retry';
import { ArrInstanceService } from '../arr-instances/arr-instance.service';
import { ImmaculateTasteProfileService } from '../immaculate-taste-profiles/immaculate-taste-profile.service';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
}

function pickNumber(obj: Record<string, unknown>, path: string): number | null {
  const v = pick(obj, path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeAndCapTitles(rawTitles: string[], max: number): string[] {
  const limit = Math.max(0, Math.min(100, Math.trunc(max ?? 0)));
  if (limit <= 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawTitles ?? []) {
    const t = normalizeTitleForMatching(String(raw ?? '').trim());
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }

  return out;
}

function normalizeStringArray(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function extractGenresFromSeedMetadata(value: unknown): string[] {
  if (!isPlainObject(value)) return [];
  const rawGenres = value['genres'];
  if (!Array.isArray(rawGenres)) return [];
  return normalizeStringArray(
    rawGenres
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean),
  );
}

function extractGenresFromTmdbDetails(value: unknown): string[] {
  if (!isPlainObject(value)) return [];
  const rawGenres = value['genres'];
  if (!Array.isArray(rawGenres)) return [];
  return normalizeStringArray(
    rawGenres
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const name = (entry as Record<string, unknown>)['name'];
        return typeof name === 'string' ? name.trim() : '';
      })
      .filter(Boolean),
  );
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return n > 0 ? n : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(baseUrl);
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('baseUrl must be a valid http(s) URL');
  }
  return baseUrl;
}

function resolveCollectionProfileDatasetId(params: {
  matchedDatasetId: string;
  matchedIsDefault: boolean;
  collectionBaseName: string | null | undefined;
}): { profileId: string; fallbackToDefault: boolean } {
  const explicitCollectionBaseName = String(
    params.collectionBaseName ?? '',
  ).trim();
  if (!params.matchedIsDefault && !explicitCollectionBaseName) {
    return { profileId: 'default', fallbackToDefault: true };
  }
  return {
    profileId: params.matchedDatasetId,
    fallbackToDefault: false,
  };
}

function buildLibrarySelectionSkippedReport(params: {
  ctx: JobContext;
  mediaType: 'movie' | 'tv';
  reason:
    | 'library_excluded'
    | 'no_selected_movie_libraries'
    | 'no_selected_tv_libraries';
  seedLibrarySectionId: string;
  seedLibrarySectionTitle: string;
}): JobReportV1 {
  const reasonMessage =
    params.reason === 'library_excluded'
      ? 'Seed library is excluded by Plex library selection.'
      : params.reason === 'no_selected_movie_libraries'
        ? 'No selected movie libraries are available.'
        : 'No selected TV libraries are available.';

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: params.ctx.jobId,
    dryRun: params.ctx.dryRun,
    trigger: params.ctx.trigger,
    headline: `Run skipped (${params.mediaType}) due to Plex library selection.`,
    sections: [],
    tasks: [
      {
        id: 'library_selection_gate',
        title: 'Plex library selection',
        status: 'skipped',
        facts: [
          { label: 'Reason', value: params.reason },
          {
            label: 'Seed library section',
            value: params.seedLibrarySectionId || 'not_provided',
          },
          {
            label: 'Seed library title',
            value: params.seedLibrarySectionTitle || 'unknown',
          },
        ],
        issues: [issue('warn', reasonMessage)],
      },
    ],
    issues: [issue('warn', reasonMessage)],
    raw: {
      skipped: true,
      reason: params.reason,
      mediaType: params.mediaType,
      seedLibrarySectionId: params.seedLibrarySectionId || null,
      seedLibrarySectionTitle: params.seedLibrarySectionTitle || null,
    },
  };
}

function buildUserMonitoringSkippedReport(params: {
  ctx: JobContext;
  mediaType: 'movie' | 'tv';
  plexUserId: string;
  plexUserTitle: string;
}): JobReportV1 {
  const reasonMessage =
    'Plex user monitoring is toggled off by admin for this user.';

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: params.ctx.jobId,
    dryRun: params.ctx.dryRun,
    trigger: params.ctx.trigger,
    headline: `Run skipped (${params.mediaType}) because Plex user monitoring is disabled.`,
    sections: [],
    tasks: [
      {
        id: 'user_monitoring_gate',
        title: 'Plex user monitoring',
        status: 'skipped',
        facts: [
          { label: 'Reason', value: 'user_toggled_off_by_admin' },
          { label: 'Plex user id', value: params.plexUserId || 'unknown' },
          { label: 'Plex user', value: params.plexUserTitle || 'unknown' },
        ],
        issues: [issue('warn', reasonMessage)],
      },
    ],
    issues: [issue('warn', reasonMessage)],
    raw: {
      skipped: true,
      reason: 'user_toggled_off_by_admin',
      mediaType: params.mediaType,
      plexUserId: params.plexUserId || null,
      plexUserTitle: params.plexUserTitle || null,
    },
  };
}

@Injectable()
export class ImmaculateTasteCollectionJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly plexServer: PlexServerService,
    private readonly plexUsers: PlexUsersService,
    private readonly recommendations: RecommendationsService,
    private readonly tmdb: TmdbService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
    private readonly seerr: SeerrService,
    private readonly immaculateTaste: ImmaculateTasteCollectionService,
    private readonly immaculateTasteTv: ImmaculateTasteShowCollectionService,
    private readonly immaculateTasteRefresher: ImmaculateTasteRefresherJob,
    private readonly arrInstances: ArrInstanceService,
    private readonly immaculateTasteProfiles: ImmaculateTasteProfileService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const { plexUserId, plexUserTitle, pinCollections } =
      await this.resolvePlexUserContext(ctx);
    const pinTarget: 'admin' | 'friends' = pinCollections ? 'admin' : 'friends';
    const mediaTypeRaw =
      typeof input['mediaType'] === 'string' ? input['mediaType'].trim() : '';
    const mediaType = mediaTypeRaw.toLowerCase();
    const isTv =
      mediaType === 'episode' || mediaType === 'show' || mediaType === 'tv';
    const resolvedMediaType: 'movie' | 'tv' = isTv ? 'tv' : 'movie';
    void ctx
      .patchSummary({ mediaType: resolvedMediaType })
      .catch(() => undefined);

    const seedTitleRaw =
      typeof input['seedTitle'] === 'string' ? input['seedTitle'].trim() : '';
    const seedTitle = normalizeTitleForMatching(seedTitleRaw);
    const seedRatingKey =
      typeof input['seedRatingKey'] === 'string'
        ? input['seedRatingKey'].trim()
        : '';
    const seedLibrarySectionIdRaw =
      typeof input['seedLibrarySectionId'] === 'number' &&
      Number.isFinite(input['seedLibrarySectionId'])
        ? String(Math.trunc(input['seedLibrarySectionId']))
        : typeof input['seedLibrarySectionId'] === 'string'
          ? input['seedLibrarySectionId'].trim()
          : '';
    const seedLibrarySectionTitle =
      typeof input['seedLibrarySectionTitle'] === 'string'
        ? input['seedLibrarySectionTitle'].trim()
        : '';
    const seedYear =
      typeof input['seedYear'] === 'number' &&
      Number.isFinite(input['seedYear'])
        ? Math.trunc(input['seedYear'])
        : null;

    await ctx.info('immaculateTastePoints: start', {
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      mediaType: mediaType || null,
      plexUserId,
      plexUserTitle,
      mode: isTv ? 'tv' : 'movie',
      pinTarget,
      seedTitle: seedTitle || null,
      seedYear,
      seedRatingKey: seedRatingKey || null,
      seedLibrarySectionId: seedLibrarySectionIdRaw || null,
      seedLibrarySectionTitle: seedLibrarySectionTitle || null,
      source: typeof input['source'] === 'string' ? input['source'] : null,
      plexEvent:
        typeof input['plexEvent'] === 'string' ? input['plexEvent'] : null,
    });

    if (!seedTitle) {
      throw new Error('Missing required job input: seedTitle');
    }

    if (isTv) {
      return await this.runTv({
        ctx,
        plexUserId,
        plexUserTitle,
        pinTarget,
        seedTitle,
        seedYear,
        seedRatingKey,
        seedLibrarySectionIdRaw,
        seedLibrarySectionTitle,
      });
    }

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);
    if (isPlexUserExcludedFromMonitoring({ settings, plexUserId })) {
      await ctx.warn(
        'immaculateTastePoints: skipped (user monitoring disabled)',
        {
          plexUserId,
          plexUserTitle,
        },
      );
      const report = buildUserMonitoringSkippedReport({
        ctx,
        mediaType: 'movie',
        plexUserId,
        plexUserTitle,
      });
      return { summary: report as unknown as JsonObject };
    }

    void ctx
      .patchSummary({
        progress: {
          step: 'dataset',
          message: 'Locating Immaculate Taste dataset…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    // --- Plex settings ---
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_libraries',
          message: 'Searching Plex movie libraries…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const sections = await withJobRetry(
      () =>
        this.plexServer.getSections({
          baseUrl: plexBaseUrl,
          token: plexToken,
        }),
      { ctx, label: 'plex: get libraries' },
    );
    const librarySelection = resolvePlexLibrarySelection({
      settings,
      sections,
    });
    const selectedSectionKeySet = new Set(librarySelection.selectedSectionKeys);
    const excludedSectionKeySet = new Set(librarySelection.excludedSectionKeys);
    if (
      seedLibrarySectionIdRaw &&
      excludedSectionKeySet.has(seedLibrarySectionIdRaw)
    ) {
      await ctx.warn('immaculateTastePoints: skipped (seed library excluded)', {
        seedLibrarySectionId: seedLibrarySectionIdRaw,
        seedLibrarySectionTitle: seedLibrarySectionTitle || null,
      });
      const report = buildLibrarySelectionSkippedReport({
        ctx,
        mediaType: 'movie',
        reason: 'library_excluded',
        seedLibrarySectionId: seedLibrarySectionIdRaw,
        seedLibrarySectionTitle,
      });
      return { summary: report as unknown as JsonObject };
    }
    const movieSections = sections
      .filter(
        (s) =>
          (s.type ?? '').toLowerCase() === 'movie' &&
          selectedSectionKeySet.has(s.key),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!movieSections.length) {
      await ctx.warn(
        'immaculateTastePoints: skipped (no selected movie libraries)',
        {
          selectedSectionKeys: librarySelection.selectedSectionKeys,
        },
      );
      const report = buildLibrarySelectionSkippedReport({
        ctx,
        mediaType: 'movie',
        reason: 'no_selected_movie_libraries',
        seedLibrarySectionId: seedLibrarySectionIdRaw,
        seedLibrarySectionTitle,
      });
      return { summary: report as unknown as JsonObject };
    }

    // Prefer the library section Plex tells us the watched movie belongs to.
    let movieSectionKey = seedLibrarySectionIdRaw || '';
    let movieLibraryName = seedLibrarySectionTitle || '';

    const seedMeta = seedRatingKey
      ? await withJobRetryOrNull(
          () =>
            this.plexServer.getMetadataDetails({
              baseUrl: plexBaseUrl,
              token: plexToken,
              ratingKey: seedRatingKey,
            }),
          {
            ctx,
            label: 'plex: get seed metadata',
            meta: { ratingKey: seedRatingKey },
          },
        )
      : null;
    if (!movieSectionKey && seedMeta?.librarySectionId) {
      movieSectionKey = seedMeta.librarySectionId;
    }
    if (!movieLibraryName && seedMeta?.librarySectionTitle) {
      movieLibraryName = seedMeta.librarySectionTitle;
    }
    let seedGenres = normalizeStringArray(seedMeta?.genres ?? []);
    const seedAudioLanguages = normalizeStringArray(
      seedMeta?.audioLanguages ?? [],
    );
    if (movieSectionKey && excludedSectionKeySet.has(movieSectionKey)) {
      await ctx.warn(
        'immaculateTastePoints: skipped (resolved seed library excluded)',
        {
          seedLibrarySectionId: movieSectionKey,
          seedLibrarySectionTitle:
            movieLibraryName || seedLibrarySectionTitle || null,
        },
      );
      const report = buildLibrarySelectionSkippedReport({
        ctx,
        mediaType: 'movie',
        reason: 'library_excluded',
        seedLibrarySectionId: movieSectionKey,
        seedLibrarySectionTitle: movieLibraryName || seedLibrarySectionTitle,
      });
      return { summary: report as unknown as JsonObject };
    }

    if (!movieSectionKey) {
      const preferred =
        movieSections.find((s) => s.title.toLowerCase() === 'movies') ??
        movieSections[0];
      movieSectionKey = preferred.key;
      movieLibraryName = preferred.title;
    } else {
      const match = sections.find((s) => s.key === movieSectionKey);
      if (match?.title) movieLibraryName = match.title;
    }

    if (!movieLibraryName) {
      movieLibraryName =
        sections.find((s) => s.key === movieSectionKey)?.title ??
        movieSections.find((s) => s.key === movieSectionKey)?.title ??
        'Movies';
    }

    // --- Recommendation + integration config ---
    const tmdbApiKey =
      pickString(secrets, 'tmdb.apiKey') ||
      pickString(secrets, 'tmdbApiKey') ||
      pickString(secrets, 'tmdb.api_key');
    if (!tmdbApiKey) throw new Error('TMDB apiKey is not set');
    if (!seedGenres.length) {
      const tmdbSeedMetadata = await withJobRetryOrNull(
        () =>
          this.tmdb.getSeedMetadata({
            apiKey: tmdbApiKey,
            seedTitle,
            seedYear,
          }),
        {
          ctx,
          label: 'tmdb: get seed metadata',
          meta: { seedTitle, seedYear },
        },
      );
      const tmdbSeedGenres = extractGenresFromSeedMetadata(tmdbSeedMetadata);
      if (tmdbSeedGenres.length) {
        seedGenres = normalizeStringArray([...seedGenres, ...tmdbSeedGenres]);
      }
      if (!seedGenres.length) {
        const tmdbSeedId = toPositiveInt(
          isPlainObject(tmdbSeedMetadata) ? tmdbSeedMetadata['tmdb_id'] : null,
        );
        if (tmdbSeedId) {
          const tmdbSeedDetails = await withJobRetryOrNull(
            () =>
              this.tmdb.getTv({
                apiKey: tmdbApiKey,
                tmdbId: tmdbSeedId,
              }),
            {
              ctx,
              label: 'tmdb: get seed tv details by id',
              meta: { tmdbId: tmdbSeedId },
            },
          );
          const tmdbDetailGenres =
            extractGenresFromTmdbDetails(tmdbSeedDetails);
          if (tmdbDetailGenres.length) {
            seedGenres = normalizeStringArray([
              ...seedGenres,
              ...tmdbDetailGenres,
            ]);
          }
        }
      }
      if (!seedGenres.length) {
        const splitPools = await withJobRetryOrNull(
          () =>
            this.tmdb.getSplitTvRecommendationCandidatePools({
              apiKey: tmdbApiKey,
              seedTitle,
              seedYear,
              includeAdult: false,
              timezone: null,
              upcomingWindowMonths: 24,
            }),
          {
            ctx,
            label: 'tmdb: get split tv pools for seed genres',
            meta: { seedTitle, seedYear },
          },
        );
        const splitSeedId = toPositiveInt(splitPools?.seed?.tmdbId);
        if (splitSeedId) {
          const splitSeedDetails = await withJobRetryOrNull(
            () =>
              this.tmdb.getTv({
                apiKey: tmdbApiKey,
                tmdbId: splitSeedId,
              }),
            {
              ctx,
              label: 'tmdb: get split seed tv details by id',
              meta: { tmdbId: splitSeedId },
            },
          );
          const splitSeedGenres =
            extractGenresFromTmdbDetails(splitSeedDetails);
          if (splitSeedGenres.length) {
            seedGenres = normalizeStringArray([
              ...seedGenres,
              ...splitSeedGenres,
            ]);
          }
        }
      }
    }

    const openAiEnabledFlag = pickBool(settings, 'openai.enabled') ?? false;
    const openAiApiKey = pickString(secrets, 'openai.apiKey');
    const openAiModel = pickString(settings, 'openai.model') || null;
    const openAiEnabled = openAiEnabledFlag && Boolean(openAiApiKey);

    const googleEnabledFlag = pickBool(settings, 'google.enabled') ?? false;
    const googleApiKey = pickString(secrets, 'google.apiKey');
    const googleSearchEngineId = pickString(settings, 'google.searchEngineId');
    const googleEnabled =
      googleEnabledFlag &&
      Boolean(googleApiKey) &&
      Boolean(googleSearchEngineId);

    const suggestionsPerRunRaw =
      pickNumber(settings, 'recommendations.count') ??
      pickNumber(settings, 'immaculateTaste.suggestionsPerRun') ??
      10;
    const suggestionsPerRun = Math.max(
      5,
      Math.min(100, Math.trunc(suggestionsPerRunRaw || 10)),
    );
    const upcomingPercentRaw =
      pickNumber(settings, 'recommendations.upcomingPercent') ?? 25;
    const upcomingPercent = Math.max(
      0,
      Math.min(75, Math.trunc(upcomingPercentRaw || 25)),
    );
    const maxPoints =
      Math.trunc(pickNumber(settings, 'immaculateTaste.maxPoints') ?? 50) || 50;
    const includeRefresherAfterUpdate =
      pickBool(settings, 'immaculateTaste.includeRefresherAfterUpdate') ?? true;
    const startSearchImmediatelySaved =
      pickBool(settings, 'jobs.immaculateTastePoints.searchImmediately') ??
      false;
    const approvalRequiredFromObservatorySaved =
      pickBool(
        settings,
        'jobs.immaculateTastePoints.approvalRequiredFromObservatory',
      ) ?? false;
    const seerrModeSelected =
      (pickBool(settings, 'jobs.immaculateTastePoints.fetchMissing.seerr') ??
        false) === true;
    const seerrBaseUrlRaw = pickString(settings, 'seerr.baseUrl');
    const seerrApiKey = pickString(secrets, 'seerr.apiKey');
    const seerrConfiguredEnabled =
      seerrModeSelected &&
      (pickBool(settings, 'seerr.enabled') ?? Boolean(seerrApiKey)) &&
      Boolean(seerrBaseUrlRaw) &&
      Boolean(seerrApiKey);
    const seerrBaseUrl = seerrConfiguredEnabled
      ? normalizeHttpUrl(seerrBaseUrlRaw)
      : '';
    const startSearchImmediately =
      startSearchImmediatelySaved && !seerrModeSelected;
    const approvalRequiredFromObservatory =
      approvalRequiredFromObservatorySaved && !seerrModeSelected;
    const webContextFraction =
      pickNumber(settings, 'recommendations.webContextFraction') ??
      pickNumber(settings, 'recommendations.web_context_fraction') ??
      0.3;

    await ctx.info('immaculateTastePoints: config', {
      movieLibraryName,
      movieSectionKey,
      seedGenres,
      seedAudioLanguages,
      openAiEnabled,
      googleEnabled,
      suggestionsPerRun,
      upcomingPercent,
      maxPoints,
      includeRefresherAfterUpdate,
      startSearchImmediatelySaved,
      approvalRequiredFromObservatorySaved,
      seerrModeSelected,
      seerrConfiguredEnabled,
      startSearchImmediately,
      approvalRequiredFromObservatory,
      webContextFraction,
    });
    const matchedProfiles =
      await this.immaculateTasteProfiles.resolveProfilesForSeed(ctx.userId, {
        plexUserId,
        seedGenres,
        seedAudioLanguages,
        seedMediaType: 'movie',
      });
    if (!matchedProfiles.length) {
      const skippedStages = [
        'recommendations',
        'plex_resolve',
        'points_update',
        'refresher',
      ];
      const skippedSummary: JsonObject = {
        mediaType: 'movie',
        plexUserId,
        plexUserTitle,
        seedTitle,
        seedYear,
        seedGenres,
        seedAudioLanguages,
        skipped: true,
        reason: 'no_matching_profile',
        profileMatch: {
          matched: false,
          reason: 'no_matching_profile',
          seedMediaType: 'movie',
          skippedStages,
        },
      };
      await ctx.warn('immaculateTastePoints: skipped (no matching profile)', {
        reason:
          'No enabled profile include criteria matched and default catch-all was unavailable for this seed',
        seedGenres,
        seedAudioLanguages,
        seedMediaType: 'movie',
        skippedStages,
      });
      const report = buildImmaculateTastePointsReport({
        ctx,
        raw: skippedSummary,
      });
      return { summary: report as unknown as JsonObject };
    }
    const matchedMovieProfiles = matchedProfiles.map((profile) => ({
      profile,
      collectionProfile: resolveCollectionProfileDatasetId({
        matchedDatasetId: profile.datasetId,
        matchedIsDefault: profile.isDefault,
        collectionBaseName: profile.movieCollectionBaseName,
      }),
    }));
    const uniqueMovieCollectionSelections = new Map<
      string,
      (typeof matchedMovieProfiles)[number]
    >();
    for (const selection of matchedMovieProfiles) {
      if (
        !uniqueMovieCollectionSelections.has(
          selection.collectionProfile.profileId,
        )
      ) {
        uniqueMovieCollectionSelections.set(
          selection.collectionProfile.profileId,
          selection,
        );
      }
    }
    const movieCollectionSelections = Array.from(
      uniqueMovieCollectionSelections.values(),
    );
    const matchedProfile = matchedMovieProfiles[0].profile;
    const movieCollectionProfile = matchedMovieProfiles[0].collectionProfile;
    const profileId = movieCollectionProfile.profileId;

    await ctx.info('immaculateTastePoints: profiles matched', {
      matchedProfileCount: matchedMovieProfiles.length,
      matchedProfiles: matchedMovieProfiles.map((selection) => ({
        profileId: selection.profile.id,
        profileDatasetId: selection.profile.datasetId,
        profileName: selection.profile.name,
        mediaType: selection.profile.mediaType,
        matchMode: selection.profile.matchMode,
        includeGenres: selection.profile.genres,
        includeAudioLanguages: selection.profile.audioLanguages,
        excludedGenres: selection.profile.excludedGenres,
        excludedAudioLanguages: selection.profile.excludedAudioLanguages,
        collectionProfileId: selection.collectionProfile.profileId,
        collectionProfileSource: selection.collectionProfile.fallbackToDefault
          ? 'default_collection_fallback'
          : 'matched_profile',
      })),
    });

    for (const selection of matchedMovieProfiles) {
      if (!selection.collectionProfile.fallbackToDefault) continue;
      await ctx.info(
        'immaculateTastePoints: using default collection dataset profile',
        {
          matchedProfileId: selection.profile.id,
          matchedProfileName: selection.profile.name,
          matchedProfileDatasetId: selection.profile.datasetId,
          reason: 'matched profile has no movie collection base name',
          effectiveCollectionProfileId: selection.collectionProfile.profileId,
        },
      );
    }

    for (const selection of movieCollectionSelections) {
      await this.immaculateTaste.ensureLegacyImported({
        ctx,
        plexUserId,
        librarySectionKey: movieSectionKey,
        profileId: selection.collectionProfile.profileId,
        maxPoints,
      });
    }

    const requestedCount = Math.min(
      100,
      Math.max(suggestionsPerRun, Math.max(1, suggestionsPerRun * 2)),
    );

    // --- Recommend (tiered pipeline: Google -> OpenAI -> TMDb) ---
    const recs = await withJobRetry(
      () =>
        this.recommendations.buildSimilarMovieTitles({
          ctx,
          seedTitle,
          seedYear,
          tmdbApiKey,
          count: requestedCount,
          webContextFraction,
          upcomingPercent,
          openai: openAiEnabled
            ? { apiKey: openAiApiKey, model: openAiModel }
            : null,
          google: googleEnabled
            ? { apiKey: googleApiKey, searchEngineId: googleSearchEngineId }
            : null,
        }),
      { ctx, label: 'recommendations: build similar movie titles' },
    );

    const normalizedTitles = normalizeAndCapTitles(
      recs.titles,
      suggestionsPerRun,
    );

    await ctx.info('immaculateTastePoints: recommendations ready', {
      strategy: recs.strategy,
      returned: recs.titles.length,
      sample: recs.titles.slice(0, 12),
      requestedCount,
      suggestionsPerRun,
      normalizedUniqueCapped: normalizedTitles.length,
    });
    const generatedTitles = normalizedTitles.slice();

    // --- Resolve in Plex ---
    void ctx
      .patchSummary({
        progress: {
          step: 'plex_match',
          message: 'Matching recommended titles in Plex…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    await ctx.info('immaculateTastePoints: resolving titles in Plex', {
      requested: recs.titles.length,
      normalizedUniqueCapped: normalizedTitles.length,
    });

    const resolved: Array<{ ratingKey: string; title: string }> = [];
    const missingTitles: string[] = [];
    for (const title of normalizedTitles) {
      const t = title.trim();
      if (!t) continue;
      const found = await withJobRetryOrNull(
        () =>
          this.plexServer.findMovieRatingKeyByTitle({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: movieSectionKey,
            title: t,
          }),
        { ctx, label: 'plex: find movie by title', meta: { title: t } },
      );
      if (found)
        resolved.push({ ratingKey: found.ratingKey, title: found.title });
      else missingTitles.push(t);
    }

    // Deduplicate by ratingKey (preserving order)
    const unique = new Map<string, string>();
    for (const it of resolved) {
      if (!unique.has(it.ratingKey)) unique.set(it.ratingKey, it.title);
    }
    const suggestedItems = Array.from(unique.entries()).map(
      ([ratingKey, title]) => ({
        ratingKey,
        title,
      }),
    );
    const resolvedTitles = suggestedItems.map((d) => d.title);

    await ctx.info('immaculateTastePoints: plex resolve done', {
      resolved: suggestedItems.length,
      missing: missingTitles.length,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: suggestedItems.slice(0, 10).map((d) => d.title),
    });

    // --- Resolve TMDB ids + ratings for BOTH in-Plex and missing titles (so we can persist pending suggestions)
    const tmdbDetailsCache = new Map<
      number,
      { vote_average: number | null; vote_count: number | null }
    >();
    const getVoteStats = async (tmdbId: number) => {
      const cached = tmdbDetailsCache.get(tmdbId) ?? null;
      if (cached) return cached;

      const vote = await withJobRetryOrNull(
        () => this.tmdb.getMovieVoteStats({ apiKey: tmdbApiKey, tmdbId }),
        { ctx, label: 'tmdb: get movie vote stats', meta: { tmdbId } },
      );
      const normalized = {
        vote_average: vote?.vote_average ?? null,
        vote_count: vote?.vote_count ?? null,
      };
      tmdbDetailsCache.set(tmdbId, normalized);
      return normalized;
    };
    const suggestedForPoints: Array<{
      tmdbId: number;
      title: string;
      tmdbVoteAvg: number | null;
      tmdbVoteCount: number | null;
      inPlex: boolean;
    }> = [];

    const missingTitleToTmdb = new Map<
      string,
      {
        tmdbId: number;
        title: string;
        year: number | null;
        vote_average: number | null;
        vote_count: number | null;
      }
    >();

    // In Plex: prefer Plex GUIDs for tmdbId, then fetch rating from TMDB.
    for (const it of suggestedItems) {
      const rk = it.ratingKey.trim();
      if (!rk) continue;

      const meta = await withJobRetryOrNull(
        () =>
          this.plexServer.getMetadataDetails({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: rk,
          }),
        { ctx, label: 'plex: get metadata details', meta: { ratingKey: rk } },
      );

      let tmdbId = meta?.tmdbIds?.[0] ?? null;
      const title = (meta?.title ?? it.title ?? '').trim() || it.title;

      if (!tmdbId) {
        const match = await withJobRetryOrNull(
          () => this.pickBestTmdbMatch({ tmdbApiKey, title }),
          { ctx, label: 'tmdb: resolve movie title', meta: { title } },
        );
        tmdbId = match?.tmdbId ?? null;
      }

      if (!tmdbId) continue;

      const cached = await getVoteStats(tmdbId);

      suggestedForPoints.push({
        tmdbId,
        title,
        tmdbVoteAvg: cached.vote_average,
        tmdbVoteCount: cached.vote_count,
        inPlex: true,
      });
    }

    // Missing in Plex: resolve via TMDB search (includes vote_average/vote_count).
    for (const title of missingTitles) {
      const t = title.trim();
      if (!t) continue;
      if (missingTitleToTmdb.has(t)) continue;

      const match = await withJobRetryOrNull(
        () => this.pickBestTmdbMatch({ tmdbApiKey, title: t }),
        { ctx, label: 'tmdb: resolve missing movie title', meta: { title: t } },
      );
      if (!match) continue;

      const cached = await getVoteStats(match.tmdbId);
      const resolved = {
        ...match,
        vote_average: cached.vote_average ?? match.vote_average,
        vote_count: cached.vote_count ?? match.vote_count,
      };

      missingTitleToTmdb.set(t, resolved);
      suggestedForPoints.push({
        tmdbId: resolved.tmdbId,
        title: resolved.title,
        tmdbVoteAvg: resolved.vote_average,
        tmdbVoteCount: resolved.vote_count,
        inPlex: false,
      });
    }

    await ctx.info('immaculateTastePoints: tmdb resolve done', {
      suggestedForPoints: suggestedForPoints.length,
      withPlex: suggestedForPoints.filter((s) => s.inPlex).length,
      pending: suggestedForPoints.filter((s) => !s.inPlex).length,
      sampleTmdb: suggestedForPoints.slice(0, 10).map((s) => s.tmdbId),
    });

    // --- Reject-list filtering (global per-user blacklist) ---
    const rejectIds = await this.prisma.rejectedSuggestion
      .findMany({
        where: {
          userId: ctx.userId,
          mediaType: 'movie',
          externalSource: 'tmdb',
        },
        select: { externalId: true },
        take: 50000,
      })
      .then(
        (rows) =>
          new Set(
            rows.map((r) => String(r.externalId ?? '').trim()).filter(Boolean),
          ),
      )
      .catch(() => new Set<string>());

    const excludedByRejectList: string[] = [];
    const filteredSuggestedForPoints = suggestedForPoints.filter((s) => {
      const key = String(s.tmdbId);
      if (!rejectIds.has(key)) return true;
      excludedByRejectList.push(s.title);
      return false;
    });
    suggestedForPoints.length = 0;
    suggestedForPoints.push(...filteredSuggestedForPoints);

    // Keep missing maps aligned for downstream Radarr + approvals.
    for (const [k, v] of Array.from(missingTitleToTmdb.entries())) {
      if (rejectIds.has(String(v.tmdbId))) missingTitleToTmdb.delete(k);
    }
    for (let i = missingTitles.length - 1; i >= 0; i -= 1) {
      const t = missingTitles[i] ?? '';
      const match = missingTitleToTmdb.get(t.trim()) ?? null;
      if (match && rejectIds.has(String(match.tmdbId)))
        missingTitles.splice(i, 1);
    }

    const seerrStats = {
      selected: seerrModeSelected,
      enabled: seerrConfiguredEnabled,
      attempted: 0,
      requested: 0,
      exists: 0,
      failed: 0,
      skipped: 0,
    };
    const seerrLists = {
      attempted: [] as string[],
      requested: [] as string[],
      exists: [] as string[],
      failed: [] as string[],
      skipped: [] as string[],
    };

    if (!ctx.dryRun && seerrModeSelected && missingTitles.length) {
      if (!seerrConfiguredEnabled) {
        await ctx.warn('seerr: skipped (selected but not configured)', {
          missingTitles: missingTitles.length,
        });
        seerrStats.skipped += missingTitles.length;
        seerrLists.skipped.push(
          ...missingTitles.map((t) => String(t ?? '').trim()).filter(Boolean),
        );
      } else {
        await ctx.info('seerr: start', {
          missingTitles: missingTitles.length,
          sampleMissing: missingTitles.slice(0, 10),
        });

        for (const title of missingTitles) {
          const tmdbMatch = missingTitleToTmdb.get(title.trim()) ?? null;
          if (!tmdbMatch) {
            seerrStats.skipped += 1;
            seerrLists.skipped.push(title.trim());
            continue;
          }

          seerrStats.attempted += 1;
          seerrLists.attempted.push(tmdbMatch.title);

          const result = await withJobRetry(
            () =>
              this.seerr.requestMovie({
                baseUrl: seerrBaseUrl,
                apiKey: seerrApiKey,
                tmdbId: tmdbMatch.tmdbId,
              }),
            {
              ctx,
              label: 'seerr: request movie',
              meta: { title: tmdbMatch.title, tmdbId: tmdbMatch.tmdbId },
            },
          ).catch((err) => ({
            status: 'failed' as const,
            requestId: null,
            error: (err as Error)?.message ?? String(err),
          }));

          if (result.status === 'requested') {
            seerrStats.requested += 1;
            seerrLists.requested.push(tmdbMatch.title);
          } else if (result.status === 'exists') {
            seerrStats.exists += 1;
            seerrLists.exists.push(tmdbMatch.title);
          } else {
            seerrStats.failed += 1;
            seerrLists.failed.push(tmdbMatch.title);
            await ctx.warn('seerr: request failed (continuing)', {
              title: tmdbMatch.title,
              tmdbId: tmdbMatch.tmdbId,
              error: result.error ?? 'unknown',
            });
          }
        }

        await ctx.info('seerr: done', seerrStats);
      }
    }

    // --- Optional Radarr: add missing titles (best-effort) ---
    const fetchMissingRadarrSaved =
      pickBool(settings, 'jobs.immaculateTastePoints.fetchMissing.radarr') ??
      true;
    const fetchMissingRadarr = fetchMissingRadarrSaved && !seerrModeSelected;
    const resolvedRadarrInstance = fetchMissingRadarr
      ? await this.arrInstances
          .resolveInstance(
            ctx.userId,
            'radarr',
            matchedProfile.radarrInstanceId,
            {
              requireConfigured: false,
            },
          )
          .catch(() => null)
      : null;
    const radarrEnabled =
      fetchMissingRadarr &&
      Boolean(resolvedRadarrInstance?.enabled) &&
      Boolean(resolvedRadarrInstance?.baseUrl) &&
      Boolean(resolvedRadarrInstance?.apiKey);
    const radarrBaseUrl = radarrEnabled
      ? String(resolvedRadarrInstance?.baseUrl ?? '')
      : '';
    const radarrApiKey = radarrEnabled
      ? String(resolvedRadarrInstance?.apiKey ?? '')
      : '';

    const radarrStats = {
      enabled: radarrEnabled,
      attempted: 0,
      added: 0,
      exists: 0,
      failed: 0,
      skipped: 0,
    };
    const radarrLists = {
      attempted: [] as string[],
      added: [] as string[],
      exists: [] as string[],
      failed: [] as string[],
      skipped: [] as string[],
    };
    const radarrSentTmdbIds: number[] = [];
    const radarrTmdbLookupCache = new Map<number, boolean | null>();

    if (!ctx.dryRun && radarrEnabled && missingTitles.length) {
      if (approvalRequiredFromObservatory) {
        await ctx.info('radarr: skipped (approval required from Observatory)', {
          missingTitles: missingTitles.length,
        });
        radarrStats.skipped += missingTitles.length;
        radarrLists.skipped.push(
          ...missingTitles.map((t) => String(t ?? '').trim()).filter(Boolean),
        );
      } else {
        await ctx.info('radarr: start', {
          missingTitles: missingTitles.length,
          sampleMissing: missingTitles.slice(0, 10),
        });

        const defaults = await withJobRetry(
          () =>
            this.pickRadarrDefaults({
              ctx,
              baseUrl: radarrBaseUrl,
              apiKey: radarrApiKey,
              preferredRootFolderPath:
                resolvedRadarrInstance?.rootFolderPath ||
                pickString(settings, 'radarr.defaultRootFolderPath') ||
                pickString(settings, 'radarr.rootFolderPath'),
              preferredQualityProfileId:
                resolvedRadarrInstance?.qualityProfileId ??
                (Math.max(
                  1,
                  Math.trunc(
                    pickNumber(settings, 'radarr.defaultQualityProfileId') ??
                      pickNumber(settings, 'radarr.qualityProfileId') ??
                      1,
                  ),
                ) ||
                  1),
              preferredTagId: (() => {
                if (resolvedRadarrInstance?.tagId) {
                  return Math.trunc(resolvedRadarrInstance.tagId);
                }
                const v =
                  pickNumber(settings, 'radarr.defaultTagId') ??
                  pickNumber(settings, 'radarr.tagId');
                return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
              })(),
            }),
          {
            ctx,
            label: 'radarr: resolve defaults',
            meta: { baseUrl: radarrBaseUrl },
          },
        ).catch((err) => ({ error: (err as Error)?.message ?? String(err) }));

        if ('error' in defaults) {
          await ctx.warn(
            'radarr: defaults unavailable (skipping adds)',
            defaults,
          );
        } else {
          let radarrIndexByTmdb: Map<number, RadarrMovie> | null = null;
          const ensureRadarrIndex = async () => {
            if (radarrIndexByTmdb) return radarrIndexByTmdb;
            const movies = await this.radarr.listMovies({
              baseUrl: radarrBaseUrl,
              apiKey: radarrApiKey,
            });
            const map = new Map<number, RadarrMovie>();
            for (const m of movies) {
              const tmdbId =
                typeof m.tmdbId === 'number' ? m.tmdbId : Number(m.tmdbId);
              if (Number.isFinite(tmdbId) && tmdbId > 0) {
                map.set(Math.trunc(tmdbId), m);
              }
            }
            radarrIndexByTmdb = map;
            return map;
          };

          for (const title of missingTitles) {
            const tmdbMatch = missingTitleToTmdb.get(title.trim()) ?? null;
            if (!tmdbMatch) {
              radarrStats.skipped += 1;
              radarrLists.skipped.push(title.trim());
              continue;
            }
            const precheck = await this.validateRadarrTmdbId({
              ctx,
              baseUrl: radarrBaseUrl,
              apiKey: radarrApiKey,
              tmdbId: tmdbMatch.tmdbId,
              cache: radarrTmdbLookupCache,
            });
            if (precheck === false) {
              radarrStats.skipped += 1;
              radarrLists.skipped.push(tmdbMatch.title);
              await ctx.warn('radarr: skipped add (tmdb precheck not found)', {
                title: tmdbMatch.title,
                tmdbId: tmdbMatch.tmdbId,
              });
              continue;
            }
            if (precheck === null) {
              await ctx.warn(
                'radarr: tmdb precheck unavailable (continuing with add)',
                {
                  title: tmdbMatch.title,
                  tmdbId: tmdbMatch.tmdbId,
                },
              );
            }
            radarrStats.attempted += 1;
            radarrLists.attempted.push(tmdbMatch.title);

            try {
              const result = await withJobRetry(
                () =>
                  this.radarr.addMovie({
                    baseUrl: radarrBaseUrl,
                    apiKey: radarrApiKey,
                    title: tmdbMatch.title,
                    tmdbId: tmdbMatch.tmdbId,
                    year: tmdbMatch.year ?? null,
                    qualityProfileId: defaults.qualityProfileId,
                    rootFolderPath: defaults.rootFolderPath,
                    tags: defaults.tagIds,
                    monitored: true,
                    minimumAvailability: 'announced',
                    searchForMovie: startSearchImmediately,
                  }),
                {
                  ctx,
                  label: 'radarr: add movie',
                  meta: { title: tmdbMatch.title, tmdbId: tmdbMatch.tmdbId },
                },
              );
              if (result.status === 'added') {
                radarrStats.added += 1;
                radarrLists.added.push(tmdbMatch.title);
                radarrSentTmdbIds.push(tmdbMatch.tmdbId);
              } else {
                radarrStats.exists += 1;
                radarrLists.exists.push(tmdbMatch.title);
                radarrSentTmdbIds.push(tmdbMatch.tmdbId);

                // Best-effort: ensure existing Radarr movies are monitored (matches the UI expectation).
                const idx = await withJobRetryOrNull(
                  () => ensureRadarrIndex(),
                  {
                    ctx,
                    label: 'radarr: index movies',
                  },
                );
                const existing = idx
                  ? (idx.get(tmdbMatch.tmdbId) ?? null)
                  : null;
                if (existing) {
                  await withJobRetry(
                    () =>
                      this.radarr.setMovieMonitored({
                        baseUrl: radarrBaseUrl,
                        apiKey: radarrApiKey,
                        movie: existing,
                        monitored: true,
                      }),
                    {
                      ctx,
                      label: 'radarr: set movie monitored',
                      meta: { tmdbId: tmdbMatch.tmdbId },
                    },
                  ).catch(() => undefined);
                }
              }
            } catch (err) {
              radarrStats.failed += 1;
              radarrLists.failed.push(tmdbMatch.title);
              await ctx.warn('radarr: add failed (continuing)', {
                title,
                error: (err as Error)?.message ?? String(err),
              });
            }
          }
        }

        await ctx.info('radarr: done', radarrStats);
      }
    }

    // --- Update points dataset (DB) ---
    const pointsByProfile: Array<{
      profileId: string;
      profileDatasetId: string;
      profileName: string;
      collectionProfileId: string;
      points: JsonObject;
    }> = [];
    if (ctx.dryRun) {
      for (const selection of movieCollectionSelections) {
        pointsByProfile.push({
          profileId: selection.profile.id,
          profileDatasetId: selection.profile.datasetId,
          profileName: selection.profile.name,
          collectionProfileId: selection.collectionProfile.profileId,
          points: { dryRun: true },
        });
      }
    } else {
      for (const selection of movieCollectionSelections) {
        const points = await this.immaculateTaste.applyPointsUpdate({
          ctx,
          plexUserId,
          librarySectionKey: movieSectionKey,
          profileId: selection.collectionProfile.profileId,
          suggested: suggestedForPoints,
          maxPoints,
        });
        pointsByProfile.push({
          profileId: selection.profile.id,
          profileDatasetId: selection.profile.datasetId,
          profileName: selection.profile.name,
          collectionProfileId: selection.collectionProfile.profileId,
          points,
        });
      }
    }
    const pointsSummary =
      pointsByProfile[0]?.points ?? ({ dryRun: true } as JsonObject);

    // Observatory approvals: mark missing titles as pending approval when enabled.
    if (!ctx.dryRun) {
      const now = new Date();
      const missingTmdbIds = Array.from(
        new Set(Array.from(missingTitleToTmdb.values()).map((v) => v.tmdbId)),
      );
      const activeTmdbIds = Array.from(
        new Set(
          suggestedForPoints.filter((s) => s.inPlex).map((s) => s.tmdbId),
        ),
      );

      if (activeTmdbIds.length) {
        for (const selection of movieCollectionSelections) {
          await this.prisma.immaculateTasteMovieLibrary
            .updateMany({
              where: {
                plexUserId,
                librarySectionKey: movieSectionKey,
                profileId: selection.collectionProfile.profileId,
                tmdbId: { in: activeTmdbIds },
              },
              data: { downloadApproval: 'none' },
            })
            .catch(() => undefined);
        }
      }

      if (missingTmdbIds.length) {
        for (const selection of movieCollectionSelections) {
          if (approvalRequiredFromObservatory) {
            await this.prisma.immaculateTasteMovieLibrary
              .updateMany({
                where: {
                  plexUserId,
                  librarySectionKey: movieSectionKey,
                  profileId: selection.collectionProfile.profileId,
                  status: 'pending',
                  tmdbId: { in: missingTmdbIds },
                  downloadApproval: 'none',
                },
                data: { downloadApproval: 'pending' },
              })
              .catch(() => undefined);
          } else {
            // Keep legacy behavior: no approvals (ensure we don't leave items stuck in approval state).
            await this.prisma.immaculateTasteMovieLibrary
              .updateMany({
                where: {
                  plexUserId,
                  librarySectionKey: movieSectionKey,
                  profileId: selection.collectionProfile.profileId,
                  status: 'pending',
                  tmdbId: { in: missingTmdbIds },
                  downloadApproval: 'pending',
                },
                data: { downloadApproval: 'none' },
              })
              .catch(() => undefined);
          }
        }
      }

      if (radarrSentTmdbIds.length) {
        for (const selection of movieCollectionSelections) {
          await this.prisma.immaculateTasteMovieLibrary
            .updateMany({
              where: {
                plexUserId,
                librarySectionKey: movieSectionKey,
                profileId: selection.collectionProfile.profileId,
                tmdbId: { in: radarrSentTmdbIds },
                sentToRadarrAt: null,
              },
              data: { sentToRadarrAt: now },
            })
            .catch(() => undefined);
        }
      }
    }

    // --- Optional chained refresher (rebuild Plex collection from points DB) ---
    const refresherByProfile: Array<{
      profileId: string;
      profileDatasetId: string;
      profileName: string;
      collectionProfileId: string;
      refresher: JsonObject | null;
    }> = [];
    let refresherSummary: JsonObject | null = null;
    if (!includeRefresherAfterUpdate) {
      const skippedRefresherSummary: JsonObject = {
        skipped: true,
        reason: 'disabled',
      };
      refresherSummary = skippedRefresherSummary;
      await ctx.info('immaculateTastePoints: refresher skipped (disabled)', {
        includeRefresherAfterUpdate,
      });
      for (const selection of movieCollectionSelections) {
        refresherByProfile.push({
          profileId: selection.profile.id,
          profileDatasetId: selection.profile.datasetId,
          profileName: selection.profile.name,
          collectionProfileId: selection.collectionProfile.profileId,
          refresher: skippedRefresherSummary,
        });
      }
    } else if (ctx.dryRun) {
      const skippedRefresherSummary: JsonObject = {
        skipped: true,
        reason: 'dry_run',
      };
      refresherSummary = skippedRefresherSummary;
      await ctx.info('immaculateTastePoints: refresher skipped (dryRun)', {
        includeRefresherAfterUpdate,
      });
      for (const selection of movieCollectionSelections) {
        refresherByProfile.push({
          profileId: selection.profile.id,
          profileDatasetId: selection.profile.datasetId,
          profileName: selection.profile.name,
          collectionProfileId: selection.collectionProfile.profileId,
          refresher: skippedRefresherSummary,
        });
      }
    } else {
      await ctx.info('immaculateTastePoints: running refresher (chained)', {
        jobId: 'immaculateTasteRefresher',
        targets: movieCollectionSelections.length,
      });
      void ctx
        .patchSummary({
          progress: {
            step: 'plex_collection_sync',
            message: 'Refreshing Plex collection…',
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
      for (const selection of movieCollectionSelections) {
        try {
          const refresherResult = await this.immaculateTasteRefresher.run({
            ...ctx,
            input: {
              ...(ctx.input ?? {}),
              plexUserId,
              plexUserTitle,
              pinCollections: true,
              pinTarget,
              includeMovies: true,
              includeTv: false,
              movieSectionKey,
              movieLibraryName,
              profileId: selection.collectionProfile.profileId,
              movieCollectionBaseName:
                selection.profile.movieCollectionBaseName ?? null,
            },
          });
          const profileRefresherSummary =
            (refresherResult.summary as JsonObject | null) ?? null;
          refresherByProfile.push({
            profileId: selection.profile.id,
            profileDatasetId: selection.profile.datasetId,
            profileName: selection.profile.name,
            collectionProfileId: selection.collectionProfile.profileId,
            refresher: profileRefresherSummary,
          });
          if (refresherSummary === null) {
            refresherSummary = profileRefresherSummary;
          }
          await ctx.info('immaculateTastePoints: refresher done (chained)', {
            profileId: selection.profile.id,
            profileDatasetId: selection.profile.datasetId,
            collectionProfileId: selection.collectionProfile.profileId,
            refresher: profileRefresherSummary,
          });
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          const failedRefresherSummary: JsonObject = { error: msg };
          refresherByProfile.push({
            profileId: selection.profile.id,
            profileDatasetId: selection.profile.datasetId,
            profileName: selection.profile.name,
            collectionProfileId: selection.collectionProfile.profileId,
            refresher: failedRefresherSummary,
          });
          if (refresherSummary === null) {
            refresherSummary = failedRefresherSummary;
          }
          await ctx.warn(
            'immaculateTastePoints: refresher failed (continuing)',
            {
              profileId: selection.profile.id,
              profileDatasetId: selection.profile.datasetId,
              collectionProfileId: selection.collectionProfile.profileId,
              error: msg,
            },
          );
        }
      }
    }

    const summary: JsonObject = {
      mediaType: 'movie',
      plexUserId,
      plexUserTitle,
      seedTitle,
      seedYear,
      seedGenres,
      seedAudioLanguages,
      profile: {
        id: matchedProfile.id,
        datasetId: matchedProfile.datasetId,
        name: matchedProfile.name,
        radarrInstanceId: matchedProfile.radarrInstanceId ?? null,
        movieCollectionBaseName: matchedProfile.movieCollectionBaseName ?? null,
      },
      collectionProfile: {
        datasetId: profileId,
        source: movieCollectionProfile.fallbackToDefault
          ? 'default_collection_fallback'
          : 'matched_profile',
      },
      matchedProfiles: matchedMovieProfiles.map((selection) => ({
        id: selection.profile.id,
        datasetId: selection.profile.datasetId,
        name: selection.profile.name,
        mediaType: selection.profile.mediaType,
        matchMode: selection.profile.matchMode,
        includeGenres: selection.profile.genres,
        includeAudioLanguages: selection.profile.audioLanguages,
        excludedGenres: selection.profile.excludedGenres,
        excludedAudioLanguages: selection.profile.excludedAudioLanguages,
        collectionProfile: {
          datasetId: selection.collectionProfile.profileId,
          source: selection.collectionProfile.fallbackToDefault
            ? 'default_collection_fallback'
            : 'matched_profile',
        },
      })),
      radarrInstance: resolvedRadarrInstance
        ? {
            id: resolvedRadarrInstance.id,
            name: resolvedRadarrInstance.name,
            isPrimary: resolvedRadarrInstance.isPrimary,
            enabled: resolvedRadarrInstance.enabled,
            baseUrl: resolvedRadarrInstance.baseUrl || null,
          }
        : null,
      profileMatch: {
        matched: true,
        reason: 'matched_profile',
        seedMediaType: 'movie',
        profileId: matchedProfile.id,
        profileDatasetId: matchedProfile.datasetId,
        profileName: matchedProfile.name,
        profileMediaType: matchedProfile.mediaType,
        profileMatchMode: matchedProfile.matchMode,
        includeGenres: matchedProfile.genres,
        includeAudioLanguages: matchedProfile.audioLanguages,
        excludedGenres: matchedProfile.excludedGenres,
        excludedAudioLanguages: matchedProfile.excludedAudioLanguages,
        matchedProfileCount: matchedMovieProfiles.length,
        matchedProfileIds: matchedMovieProfiles.map(
          (selection) => selection.profile.id,
        ),
        matchedProfileDatasetIds: matchedMovieProfiles.map(
          (selection) => selection.profile.datasetId,
        ),
      },
      recommendationStrategy: recs.strategy,
      recommendationDebug: recs.debug,
      generated: generatedTitles.length,
      generatedTitles,
      resolvedInPlex: suggestedItems.length,
      resolvedTitles,
      missingInPlex: missingTitles.length,
      missingTitles,
      excludedByRejectListTitles: Array.from(
        new Set(
          excludedByRejectList
            .map((s) => String(s ?? '').trim())
            .filter(Boolean),
        ),
      ),
      excludedByRejectListCount: excludedByRejectList.length,
      approvalRequiredFromObservatory,
      seerrModeSelected,
      seerrConfiguredEnabled,
      seerr: seerrStats,
      seerrLists,
      radarr: radarrStats,
      radarrLists,
      startSearchImmediately,
      points: pointsSummary,
      pointsByProfile,
      refresher: refresherSummary,
      refresherByProfile,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: suggestedItems.slice(0, 10).map((d) => d.title),
    };

    await ctx.info('immaculateTastePoints: done', summary);
    const report = buildImmaculateTastePointsReport({ ctx, raw: summary });
    return { summary: report as unknown as JsonObject };
  }

  private async runTv(params: {
    ctx: JobContext;
    plexUserId: string;
    plexUserTitle: string;
    pinTarget: 'admin' | 'friends';
    seedTitle: string;
    seedYear: number | null;
    seedRatingKey: string;
    seedLibrarySectionIdRaw: string;
    seedLibrarySectionTitle: string;
  }): Promise<JobRunResult> {
    const {
      ctx,
      plexUserId,
      plexUserTitle,
      pinTarget,
      seedTitle,
      seedYear,
      seedRatingKey,
      seedLibrarySectionIdRaw,
      seedLibrarySectionTitle,
    } = params;

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);
    if (isPlexUserExcludedFromMonitoring({ settings, plexUserId })) {
      await ctx.warn(
        'immaculateTastePoints(tv): skipped (user monitoring disabled)',
        {
          plexUserId,
          plexUserTitle,
        },
      );
      const report = buildUserMonitoringSkippedReport({
        ctx,
        mediaType: 'tv',
        plexUserId,
        plexUserTitle,
      });
      return { summary: report as unknown as JsonObject };
    }

    void ctx
      .patchSummary({
        progress: {
          step: 'dataset',
          message: 'Locating Immaculate Taste dataset…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    // --- Plex settings ---
    const plexBaseUrlRaw =
      pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
    const plexToken =
      pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
    if (!plexBaseUrlRaw) throw new Error('Plex baseUrl is not set');
    if (!plexToken) throw new Error('Plex token is not set');
    const plexBaseUrl = normalizeHttpUrl(plexBaseUrlRaw);

    void ctx
      .patchSummary({
        progress: {
          step: 'plex_libraries',
          message: 'Searching Plex TV libraries…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const sections = await withJobRetry(
      () =>
        this.plexServer.getSections({
          baseUrl: plexBaseUrl,
          token: plexToken,
        }),
      { ctx, label: 'plex: get libraries' },
    );
    const librarySelection = resolvePlexLibrarySelection({
      settings,
      sections,
    });
    const selectedSectionKeySet = new Set(librarySelection.selectedSectionKeys);
    const excludedSectionKeySet = new Set(librarySelection.excludedSectionKeys);
    if (
      seedLibrarySectionIdRaw &&
      excludedSectionKeySet.has(seedLibrarySectionIdRaw)
    ) {
      await ctx.warn(
        'immaculateTastePoints(tv): skipped (seed library excluded)',
        {
          seedLibrarySectionId: seedLibrarySectionIdRaw,
          seedLibrarySectionTitle: seedLibrarySectionTitle || null,
        },
      );
      const report = buildLibrarySelectionSkippedReport({
        ctx,
        mediaType: 'tv',
        reason: 'library_excluded',
        seedLibrarySectionId: seedLibrarySectionIdRaw,
        seedLibrarySectionTitle,
      });
      return { summary: report as unknown as JsonObject };
    }
    const tvSections = sections
      .filter(
        (s) =>
          (s.type ?? '').toLowerCase() === 'show' &&
          selectedSectionKeySet.has(s.key),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
    if (!tvSections.length) {
      await ctx.warn(
        'immaculateTastePoints(tv): skipped (no selected TV libraries)',
        {
          selectedSectionKeys: librarySelection.selectedSectionKeys,
        },
      );
      const report = buildLibrarySelectionSkippedReport({
        ctx,
        mediaType: 'tv',
        reason: 'no_selected_tv_libraries',
        seedLibrarySectionId: seedLibrarySectionIdRaw,
        seedLibrarySectionTitle,
      });
      return { summary: report as unknown as JsonObject };
    }

    let tvSectionKey = seedLibrarySectionIdRaw || '';
    let tvLibraryName = seedLibrarySectionTitle || '';

    const seedMeta = seedRatingKey
      ? await withJobRetryOrNull(
          () =>
            this.plexServer.getMetadataDetails({
              baseUrl: plexBaseUrl,
              token: plexToken,
              ratingKey: seedRatingKey,
            }),
          {
            ctx,
            label: 'plex: get seed metadata',
            meta: { ratingKey: seedRatingKey },
          },
        )
      : null;
    if (!tvSectionKey && seedMeta?.librarySectionId) {
      tvSectionKey = seedMeta.librarySectionId;
    }
    if (!tvLibraryName && seedMeta?.librarySectionTitle) {
      tvLibraryName = seedMeta.librarySectionTitle;
    }
    let seedGenres = normalizeStringArray(seedMeta?.genres ?? []);
    const seedAudioLanguages = normalizeStringArray(
      seedMeta?.audioLanguages ?? [],
    );
    if (tvSectionKey && excludedSectionKeySet.has(tvSectionKey)) {
      await ctx.warn(
        'immaculateTastePoints(tv): skipped (resolved seed library excluded)',
        {
          seedLibrarySectionId: tvSectionKey,
          seedLibrarySectionTitle:
            tvLibraryName || seedLibrarySectionTitle || null,
        },
      );
      const report = buildLibrarySelectionSkippedReport({
        ctx,
        mediaType: 'tv',
        reason: 'library_excluded',
        seedLibrarySectionId: tvSectionKey,
        seedLibrarySectionTitle: tvLibraryName || seedLibrarySectionTitle,
      });
      return { summary: report as unknown as JsonObject };
    }

    if (!tvSectionKey) {
      const preferred =
        tvSections.find((s) => s.title.toLowerCase() === 'tv shows') ??
        tvSections.find((s) => s.title.toLowerCase() === 'shows') ??
        tvSections[0];
      tvSectionKey = preferred.key;
      tvLibraryName = preferred.title;
    } else {
      const match = sections.find((s) => s.key === tvSectionKey);
      if (match?.title) tvLibraryName = match.title;
      if (match?.type && match.type.toLowerCase() !== 'show') {
        await ctx.warn(
          'plex: seed librarySectionID is not a TV library (continuing)',
          {
            tvSectionKey,
            libraryTitle: match.title,
            libraryType: match.type,
          },
        );
      }
    }

    if (!tvLibraryName) {
      tvLibraryName =
        sections.find((s) => s.key === tvSectionKey)?.title ??
        tvSections.find((s) => s.key === tvSectionKey)?.title ??
        'TV Shows';
    }

    // --- Recommendation + integration config ---
    const tmdbApiKey =
      pickString(secrets, 'tmdb.apiKey') ||
      pickString(secrets, 'tmdbApiKey') ||
      pickString(secrets, 'tmdb.api_key');
    if (!tmdbApiKey) throw new Error('TMDB apiKey is not set');
    if (!seedGenres.length && seedMeta?.grandparentRatingKey) {
      const showSeedMeta = await withJobRetryOrNull(
        () =>
          this.plexServer.getMetadataDetails({
            baseUrl: plexBaseUrl,
            token: plexToken,
            ratingKey: seedMeta.grandparentRatingKey ?? '',
          }),
        {
          ctx,
          label: 'plex: get seed show metadata',
          meta: { ratingKey: seedMeta.grandparentRatingKey },
        },
      );
      if (showSeedMeta?.genres?.length) {
        seedGenres = normalizeStringArray([
          ...seedGenres,
          ...showSeedMeta.genres,
        ]);
      }
    }
    if (!seedGenres.length) {
      const tmdbSeedMetadata = await withJobRetryOrNull(
        () =>
          this.tmdb.getTvSeedMetadata({
            apiKey: tmdbApiKey,
            seedTitle,
            seedYear,
          }),
        {
          ctx,
          label: 'tmdb: get seed tv metadata',
          meta: { seedTitle, seedYear },
        },
      );
      const tmdbSeedGenres = extractGenresFromSeedMetadata(tmdbSeedMetadata);
      if (tmdbSeedGenres.length) {
        seedGenres = normalizeStringArray([...seedGenres, ...tmdbSeedGenres]);
      }
    }

    const openAiEnabledFlag = pickBool(settings, 'openai.enabled') ?? false;
    const openAiApiKey = pickString(secrets, 'openai.apiKey');
    const openAiModel = pickString(settings, 'openai.model') || null;
    const openAiEnabled = openAiEnabledFlag && Boolean(openAiApiKey);

    const googleEnabledFlag = pickBool(settings, 'google.enabled') ?? false;
    const googleApiKey = pickString(secrets, 'google.apiKey');
    const googleSearchEngineId = pickString(settings, 'google.searchEngineId');
    const googleEnabled =
      googleEnabledFlag &&
      Boolean(googleApiKey) &&
      Boolean(googleSearchEngineId);

    const suggestionsPerRunRaw =
      pickNumber(settings, 'recommendations.count') ??
      pickNumber(settings, 'immaculateTaste.suggestionsPerRun') ??
      10;
    const suggestionsPerRun = Math.max(
      5,
      Math.min(100, Math.trunc(suggestionsPerRunRaw || 10)),
    );
    const upcomingPercentRaw =
      pickNumber(settings, 'recommendations.upcomingPercent') ?? 25;
    const upcomingPercent = Math.max(
      0,
      Math.min(75, Math.trunc(upcomingPercentRaw || 25)),
    );
    const maxPoints =
      Math.trunc(pickNumber(settings, 'immaculateTaste.maxPoints') ?? 50) || 50;
    const includeRefresherAfterUpdate =
      pickBool(settings, 'immaculateTaste.includeRefresherAfterUpdate') ?? true;
    const startSearchImmediatelySaved =
      pickBool(settings, 'jobs.immaculateTastePoints.searchImmediately') ??
      false;
    const approvalRequiredFromObservatorySaved =
      pickBool(
        settings,
        'jobs.immaculateTastePoints.approvalRequiredFromObservatory',
      ) ?? false;
    const seerrModeSelected =
      (pickBool(settings, 'jobs.immaculateTastePoints.fetchMissing.seerr') ??
        false) === true;
    const seerrBaseUrlRaw = pickString(settings, 'seerr.baseUrl');
    const seerrApiKey = pickString(secrets, 'seerr.apiKey');
    const seerrConfiguredEnabled =
      seerrModeSelected &&
      (pickBool(settings, 'seerr.enabled') ?? Boolean(seerrApiKey)) &&
      Boolean(seerrBaseUrlRaw) &&
      Boolean(seerrApiKey);
    const seerrBaseUrl = seerrConfiguredEnabled
      ? normalizeHttpUrl(seerrBaseUrlRaw)
      : '';
    const startSearchImmediately =
      startSearchImmediatelySaved && !seerrModeSelected;
    const approvalRequiredFromObservatory =
      approvalRequiredFromObservatorySaved && !seerrModeSelected;
    const webContextFraction =
      pickNumber(settings, 'recommendations.webContextFraction') ??
      pickNumber(settings, 'recommendations.web_context_fraction') ??
      0.3;

    await ctx.info('immaculateTastePoints(tv): config', {
      tvLibraryName,
      tvSectionKey,
      seedGenres,
      seedAudioLanguages,
      openAiEnabled,
      googleEnabled,
      suggestionsPerRun,
      upcomingPercent,
      maxPoints,
      includeRefresherAfterUpdate,
      startSearchImmediatelySaved,
      approvalRequiredFromObservatorySaved,
      seerrModeSelected,
      seerrConfiguredEnabled,
      startSearchImmediately,
      approvalRequiredFromObservatory,
      webContextFraction,
    });
    const matchedProfiles =
      await this.immaculateTasteProfiles.resolveProfilesForSeed(ctx.userId, {
        plexUserId,
        seedGenres,
        seedAudioLanguages,
        seedMediaType: 'show',
      });
    if (!matchedProfiles.length) {
      const skippedStages = [
        'recommendations',
        'plex_resolve',
        'points_update',
        'refresher',
      ];
      const skippedSummary: JsonObject = {
        mediaType: 'tv',
        plexUserId,
        plexUserTitle,
        seedTitle,
        seedYear,
        seedGenres,
        seedAudioLanguages,
        skipped: true,
        reason: 'no_matching_profile',
        profileMatch: {
          matched: false,
          reason: 'no_matching_profile',
          seedMediaType: 'show',
          skippedStages,
        },
      };
      await ctx.warn(
        'immaculateTastePoints(tv): skipped (no matching profile)',
        {
          reason:
            'No enabled profile include criteria matched and default catch-all was unavailable for this seed',
          seedGenres,
          seedAudioLanguages,
          seedMediaType: 'show',
          skippedStages,
        },
      );
      const report = buildImmaculateTastePointsReport({
        ctx,
        raw: skippedSummary,
      });
      return { summary: report as unknown as JsonObject };
    }
    const matchedShowProfiles = matchedProfiles.map((profile) => ({
      profile,
      collectionProfile: resolveCollectionProfileDatasetId({
        matchedDatasetId: profile.datasetId,
        matchedIsDefault: profile.isDefault,
        collectionBaseName: profile.showCollectionBaseName,
      }),
    }));
    const uniqueShowCollectionSelections = new Map<
      string,
      (typeof matchedShowProfiles)[number]
    >();
    for (const selection of matchedShowProfiles) {
      if (
        !uniqueShowCollectionSelections.has(
          selection.collectionProfile.profileId,
        )
      ) {
        uniqueShowCollectionSelections.set(
          selection.collectionProfile.profileId,
          selection,
        );
      }
    }
    const showCollectionSelections = Array.from(
      uniqueShowCollectionSelections.values(),
    );
    const matchedProfile = matchedShowProfiles[0].profile;
    const showCollectionProfile = matchedShowProfiles[0].collectionProfile;
    const profileId = showCollectionProfile.profileId;

    await ctx.info('immaculateTastePoints(tv): profiles matched', {
      matchedProfileCount: matchedShowProfiles.length,
      matchedProfiles: matchedShowProfiles.map((selection) => ({
        profileId: selection.profile.id,
        profileDatasetId: selection.profile.datasetId,
        profileName: selection.profile.name,
        mediaType: selection.profile.mediaType,
        matchMode: selection.profile.matchMode,
        includeGenres: selection.profile.genres,
        includeAudioLanguages: selection.profile.audioLanguages,
        excludedGenres: selection.profile.excludedGenres,
        excludedAudioLanguages: selection.profile.excludedAudioLanguages,
        collectionProfileId: selection.collectionProfile.profileId,
        collectionProfileSource: selection.collectionProfile.fallbackToDefault
          ? 'default_collection_fallback'
          : 'matched_profile',
      })),
    });

    for (const selection of matchedShowProfiles) {
      if (!selection.collectionProfile.fallbackToDefault) continue;
      await ctx.info(
        'immaculateTastePoints(tv): using default collection dataset profile',
        {
          matchedProfileId: selection.profile.id,
          matchedProfileName: selection.profile.name,
          matchedProfileDatasetId: selection.profile.datasetId,
          reason: 'matched profile has no TV collection base name',
          effectiveCollectionProfileId: selection.collectionProfile.profileId,
        },
      );
    }

    for (const selection of showCollectionSelections) {
      await this.immaculateTasteTv.ensureLegacyImported({
        ctx,
        plexUserId,
        profileId: selection.collectionProfile.profileId,
        maxPoints,
      });
    }

    const requestedCount = Math.min(
      100,
      Math.max(suggestionsPerRun, Math.max(1, suggestionsPerRun * 2)),
    );

    const recs = await withJobRetry(
      () =>
        this.recommendations.buildSimilarTvTitles({
          ctx,
          seedTitle,
          seedYear,
          tmdbApiKey,
          count: requestedCount,
          webContextFraction,
          upcomingPercent,
          openai: openAiEnabled
            ? { apiKey: openAiApiKey, model: openAiModel }
            : null,
          google: googleEnabled
            ? { apiKey: googleApiKey, searchEngineId: googleSearchEngineId }
            : null,
        }),
      { ctx, label: 'recommendations: build similar tv titles' },
    );

    const normalizedTitles = normalizeAndCapTitles(
      recs.titles,
      suggestionsPerRun,
    );

    await ctx.info('immaculateTastePoints(tv): recommendations ready', {
      strategy: recs.strategy,
      returned: recs.titles.length,
      sample: recs.titles.slice(0, 12),
      requestedCount,
      suggestionsPerRun,
      normalizedUniqueCapped: normalizedTitles.length,
    });
    const generatedTitles = normalizedTitles.slice();

    // --- Resolve in Plex ---
    void ctx
      .patchSummary({
        progress: {
          step: 'plex_match',
          message: 'Matching recommended titles in Plex…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    await ctx.info('immaculateTastePoints(tv): resolving titles in Plex', {
      requested: recs.titles.length,
      normalizedUniqueCapped: normalizedTitles.length,
    });

    const resolved: Array<{ ratingKey: string; title: string }> = [];
    const missingTitles: string[] = [];
    for (const title of normalizedTitles) {
      const t = title.trim();
      if (!t) continue;
      const found = await withJobRetryOrNull(
        () =>
          this.plexServer.findShowRatingKeyByTitle({
            baseUrl: plexBaseUrl,
            token: plexToken,
            librarySectionKey: tvSectionKey,
            title: t,
          }),
        { ctx, label: 'plex: find show by title', meta: { title: t } },
      );
      if (found)
        resolved.push({ ratingKey: found.ratingKey, title: found.title });
      else missingTitles.push(t);
    }

    const unique = new Map<string, string>();
    for (const it of resolved) {
      if (!unique.has(it.ratingKey)) unique.set(it.ratingKey, it.title);
    }
    const suggestedItems = Array.from(unique.entries()).map(
      ([ratingKey, title]) => ({ ratingKey, title }),
    );
    const resolvedTitles = suggestedItems.map((d) => d.title);

    await ctx.info('immaculateTastePoints(tv): plex resolve done', {
      resolved: suggestedItems.length,
      missing: missingTitles.length,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: suggestedItems.slice(0, 10).map((d) => d.title),
    });

    // --- Resolve TMDB ids + tvdb ids + ratings for BOTH in-Plex and missing titles
    const matchCache = new Map<
      string,
      {
        tmdbId: number;
        tvdbId: number | null;
        title: string;
        year: number | null;
        vote_average: number | null;
        vote_count: number | null;
      } | null
    >();
    const getMatch = async (title: string) => {
      const key = title.trim().toLowerCase();
      if (!key) return null;
      if (matchCache.has(key)) return matchCache.get(key) ?? null;
      const match = await this.pickBestTmdbTvMatch({
        ctx,
        tmdbApiKey,
        title,
      });
      matchCache.set(key, match);
      return match;
    };

    const suggestedForPoints: Array<{
      tvdbId: number;
      tmdbId: number | null;
      title: string;
      tmdbVoteAvg: number | null;
      tmdbVoteCount: number | null;
      inPlex: boolean;
    }> = [];

    const missingTitleToIds = new Map<
      string,
      { tmdbId: number | null; tvdbId: number | null; title: string }
    >();

    const pushSuggested = (
      match: {
        tmdbId: number;
        tvdbId: number | null;
        title: string;
        vote_average: number | null;
        vote_count: number | null;
      },
      inPlex: boolean,
    ) => {
      if (!match.tvdbId) return;
      suggestedForPoints.push({
        tvdbId: match.tvdbId,
        tmdbId: match.tmdbId,
        title: match.title,
        tmdbVoteAvg: match.vote_average,
        tmdbVoteCount: match.vote_count,
        inPlex,
      });
    };

    for (const it of suggestedItems) {
      const match = await getMatch(it.title);
      if (!match) continue;
      pushSuggested(match, true);
    }
    for (const title of missingTitles) {
      const match = await getMatch(title);
      if (!match) continue;
      pushSuggested(match, false);
      missingTitleToIds.set(title.trim(), {
        tmdbId: match.tmdbId,
        tvdbId: match.tvdbId,
        title: match.title,
      });
    }

    // --- Reject-list filtering (global per-user blacklist) ---
    const rejectIds = await this.prisma.rejectedSuggestion
      .findMany({
        where: {
          userId: ctx.userId,
          mediaType: 'tv',
          externalSource: 'tvdb',
        },
        select: { externalId: true },
        take: 50000,
      })
      .then(
        (rows) =>
          new Set(
            rows.map((r) => String(r.externalId ?? '').trim()).filter(Boolean),
          ),
      )
      .catch(() => new Set<string>());

    const excludedByRejectList: string[] = [];
    const filteredSuggestedForPoints = suggestedForPoints.filter((s) => {
      const key = String(s.tvdbId);
      if (!rejectIds.has(key)) return true;
      excludedByRejectList.push(s.title);
      return false;
    });
    suggestedForPoints.length = 0;
    suggestedForPoints.push(...filteredSuggestedForPoints);

    for (const [k, v] of Array.from(missingTitleToIds.entries())) {
      if (v?.tvdbId && rejectIds.has(String(v.tvdbId)))
        missingTitleToIds.delete(k);
    }
    for (let i = missingTitles.length - 1; i >= 0; i -= 1) {
      const t = missingTitles[i] ?? '';
      const ids = missingTitleToIds.get(t.trim()) ?? null;
      if (ids?.tvdbId && rejectIds.has(String(ids.tvdbId)))
        missingTitles.splice(i, 1);
    }

    const seerrStats = {
      selected: seerrModeSelected,
      enabled: seerrConfiguredEnabled,
      attempted: 0,
      requested: 0,
      exists: 0,
      failed: 0,
      skipped: 0,
    };
    const seerrLists = {
      attempted: [] as string[],
      requested: [] as string[],
      exists: [] as string[],
      failed: [] as string[],
      skipped: [] as string[],
    };

    if (!ctx.dryRun && seerrModeSelected && missingTitles.length) {
      if (!seerrConfiguredEnabled) {
        await ctx.warn('seerr: skipped (selected but not configured)', {
          missingTitles: missingTitles.length,
        });
        seerrStats.skipped += missingTitles.length;
        seerrLists.skipped.push(
          ...missingTitles.map((t) => String(t ?? '').trim()).filter(Boolean),
        );
      } else {
        await ctx.info('seerr: start', {
          missingTitles: missingTitles.length,
          sampleMissing: missingTitles.slice(0, 10),
        });

        for (const title of missingTitles) {
          const ids = missingTitleToIds.get(title.trim()) ?? null;
          const tmdbId = ids?.tmdbId ?? null;
          const tvdbId = ids?.tvdbId ?? null;
          if (!ids || tmdbId === null || tvdbId === null) {
            seerrStats.skipped += 1;
            seerrLists.skipped.push(title.trim());
            continue;
          }

          seerrStats.attempted += 1;
          seerrLists.attempted.push(ids.title);

          const result = await withJobRetry(
            () =>
              this.seerr.requestTvAllSeasons({
                baseUrl: seerrBaseUrl,
                apiKey: seerrApiKey,
                tmdbId,
                tvdbId,
              }),
            {
              ctx,
              label: 'seerr: request tv',
              meta: {
                title: ids.title,
                tmdbId: ids.tmdbId,
                tvdbId: ids.tvdbId,
              },
            },
          ).catch((err) => ({
            status: 'failed' as const,
            requestId: null,
            error: (err as Error)?.message ?? String(err),
          }));

          if (result.status === 'requested') {
            seerrStats.requested += 1;
            seerrLists.requested.push(ids.title);
          } else if (result.status === 'exists') {
            seerrStats.exists += 1;
            seerrLists.exists.push(ids.title);
          } else {
            seerrStats.failed += 1;
            seerrLists.failed.push(ids.title);
            await ctx.warn('seerr: request failed (continuing)', {
              title: ids.title,
              tmdbId: ids.tmdbId,
              tvdbId: ids.tvdbId,
              error: result.error ?? 'unknown',
            });
          }
        }

        await ctx.info('seerr: done', seerrStats);
      }
    }

    // --- Sonarr add missing series (best-effort)
    const fetchMissingSonarrSaved =
      pickBool(settings, 'jobs.immaculateTastePoints.fetchMissing.sonarr') ??
      true;
    const fetchMissingSonarr = fetchMissingSonarrSaved && !seerrModeSelected;
    const resolvedSonarrInstance = fetchMissingSonarr
      ? await this.arrInstances
          .resolveInstance(
            ctx.userId,
            'sonarr',
            matchedProfile.sonarrInstanceId,
            {
              requireConfigured: false,
            },
          )
          .catch(() => null)
      : null;
    const sonarrEnabled =
      fetchMissingSonarr &&
      Boolean(resolvedSonarrInstance?.enabled) &&
      Boolean(resolvedSonarrInstance?.baseUrl) &&
      Boolean(resolvedSonarrInstance?.apiKey);
    const sonarrBaseUrl = sonarrEnabled
      ? String(resolvedSonarrInstance?.baseUrl ?? '')
      : '';
    const sonarrApiKey = sonarrEnabled
      ? String(resolvedSonarrInstance?.apiKey ?? '')
      : '';

    const sonarrStats = {
      enabled: sonarrEnabled,
      attempted: 0,
      added: 0,
      exists: 0,
      skipped: 0,
      failed: 0,
    };
    const sonarrLists = {
      attempted: [] as string[],
      added: [] as string[],
      exists: [] as string[],
      failed: [] as string[],
      skipped: [] as string[],
    };
    const sonarrSentTvdbIds: number[] = [];
    const sonarrTvdbLookupCache = new Map<number, boolean | null>();

    if (!ctx.dryRun && sonarrEnabled && missingTitles.length) {
      if (approvalRequiredFromObservatory) {
        await ctx.info('sonarr: skipped (approval required from Observatory)', {
          missingTitles: missingTitles.length,
        });
        sonarrStats.skipped += missingTitles.length;
        sonarrLists.skipped.push(
          ...missingTitles.map((t) => String(t ?? '').trim()).filter(Boolean),
        );
      } else {
        const defaults = await withJobRetry(
          () =>
            this.pickSonarrDefaults({
              ctx,
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              preferredRootFolderPath:
                resolvedSonarrInstance?.rootFolderPath ||
                pickString(settings, 'sonarr.defaultRootFolderPath') ||
                pickString(settings, 'sonarr.rootFolderPath'),
              preferredQualityProfileId:
                resolvedSonarrInstance?.qualityProfileId ??
                (Math.max(
                  1,
                  Math.trunc(
                    pickNumber(settings, 'sonarr.defaultQualityProfileId') ??
                      pickNumber(settings, 'sonarr.qualityProfileId') ??
                      1,
                  ),
                ) ||
                  1),
              preferredTagId: (() => {
                if (resolvedSonarrInstance?.tagId) {
                  return Math.trunc(resolvedSonarrInstance.tagId);
                }
                const v =
                  pickNumber(settings, 'sonarr.defaultTagId') ??
                  pickNumber(settings, 'sonarr.tagId');
                return v && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
              })(),
            }),
          {
            ctx,
            label: 'sonarr: resolve defaults',
            meta: { baseUrl: sonarrBaseUrl },
          },
        ).catch((err) => ({ error: (err as Error)?.message ?? String(err) }));

        if ('error' in defaults) {
          await ctx.warn(
            'sonarr: defaults unavailable (skipping adds)',
            defaults,
          );
        } else {
          // Best-effort: keep existing series monitored when they already exist in Sonarr.
          let sonarrIndexByTvdb: Map<number, SonarrSeries> | null = null;
          const ensureSonarrIndex = async () => {
            if (sonarrIndexByTvdb) return sonarrIndexByTvdb;
            const all = await this.sonarr.listSeries({
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
            });
            const map = new Map<number, SonarrSeries>();
            for (const s of all) {
              const tvdbId =
                typeof s.tvdbId === 'number' ? s.tvdbId : Number(s.tvdbId);
              if (Number.isFinite(tvdbId) && tvdbId > 0) {
                map.set(Math.trunc(tvdbId), s);
              }
            }
            sonarrIndexByTvdb = map;
            return map;
          };

          for (const title of missingTitles) {
            const ids = missingTitleToIds.get(title.trim()) ?? null;
            if (!ids || !ids.tvdbId) {
              sonarrStats.skipped += 1;
              sonarrLists.skipped.push(title.trim());
              continue;
            }
            const tvdbId = ids.tvdbId;
            sonarrStats.attempted += 1;
            sonarrLists.attempted.push(ids.title);
            const precheck = await this.validateSonarrTvdbId({
              ctx,
              baseUrl: sonarrBaseUrl,
              apiKey: sonarrApiKey,
              tvdbId,
              cache: sonarrTvdbLookupCache,
            });
            if (precheck === false) {
              sonarrStats.skipped += 1;
              sonarrLists.skipped.push(ids.title);
              await ctx.warn('sonarr: skipped add (tvdb precheck not found)', {
                title: ids.title,
                tvdbId,
              });
              continue;
            }
            if (precheck === null) {
              await ctx.warn(
                'sonarr: tvdb precheck unavailable (continuing with add)',
                {
                  title: ids.title,
                  tvdbId,
                },
              );
            }

            try {
              const result = await withJobRetry(
                () =>
                  this.sonarr.addSeries({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                    title: ids.title,
                    tvdbId,
                    qualityProfileId: defaults.qualityProfileId,
                    rootFolderPath: defaults.rootFolderPath,
                    tags: defaults.tagIds,
                    monitored: true,
                    searchForMissingEpisodes: startSearchImmediately,
                    searchForCutoffUnmetEpisodes: startSearchImmediately,
                  }),
                {
                  ctx,
                  label: 'sonarr: add series',
                  meta: { title: ids.title, tvdbId },
                },
              );
              if (result.status === 'added') {
                sonarrStats.added += 1;
                sonarrLists.added.push(ids.title);
                sonarrSentTvdbIds.push(tvdbId);
              } else {
                sonarrStats.exists += 1;
                sonarrLists.exists.push(ids.title);
                sonarrSentTvdbIds.push(tvdbId);

                const idx = await withJobRetryOrNull(
                  () => ensureSonarrIndex(),
                  {
                    ctx,
                    label: 'sonarr: index series',
                  },
                );
                const existing = idx ? (idx.get(ids.tvdbId) ?? null) : null;
                if (existing && existing.monitored === false) {
                  await withJobRetry(
                    () =>
                      this.sonarr.updateSeries({
                        baseUrl: sonarrBaseUrl,
                        apiKey: sonarrApiKey,
                        series: { ...existing, monitored: true },
                      }),
                    {
                      ctx,
                      label: 'sonarr: set series monitored',
                      meta: { tvdbId: ids.tvdbId },
                    },
                  ).catch(() => undefined);
                }
              }
            } catch (err) {
              sonarrStats.failed += 1;
              sonarrLists.failed.push(ids.title);
              await ctx.warn('sonarr: add failed (continuing)', {
                title,
                error: (err as Error)?.message ?? String(err),
              });
            }
          }
        }

        await ctx.info('sonarr: done', sonarrStats);
      }
    }

    // --- Update points dataset (DB) ---
    const pointsByProfile: Array<{
      profileId: string;
      profileDatasetId: string;
      profileName: string;
      collectionProfileId: string;
      points: JsonObject;
    }> = [];
    if (ctx.dryRun) {
      for (const selection of showCollectionSelections) {
        pointsByProfile.push({
          profileId: selection.profile.id,
          profileDatasetId: selection.profile.datasetId,
          profileName: selection.profile.name,
          collectionProfileId: selection.collectionProfile.profileId,
          points: { dryRun: true },
        });
      }
    } else {
      for (const selection of showCollectionSelections) {
        const points = await this.immaculateTasteTv.applyPointsUpdate({
          ctx,
          plexUserId,
          librarySectionKey: tvSectionKey,
          profileId: selection.collectionProfile.profileId,
          suggested: suggestedForPoints,
          maxPoints,
        });
        pointsByProfile.push({
          profileId: selection.profile.id,
          profileDatasetId: selection.profile.datasetId,
          profileName: selection.profile.name,
          collectionProfileId: selection.collectionProfile.profileId,
          points,
        });
      }
    }
    const pointsSummary =
      pointsByProfile[0]?.points ?? ({ dryRun: true } as JsonObject);

    // Observatory approvals: mark missing titles as pending approval when enabled.
    if (!ctx.dryRun) {
      const now = new Date();
      const missingTvdbIds = Array.from(
        new Set(
          Array.from(missingTitleToIds.values())
            .map((v) => v.tvdbId)
            .filter((x): x is number => Boolean(x)),
        ),
      );
      const activeTvdbIds = Array.from(
        new Set(
          suggestedForPoints.filter((s) => s.inPlex).map((s) => s.tvdbId),
        ),
      );

      if (activeTvdbIds.length) {
        for (const selection of showCollectionSelections) {
          await this.prisma.immaculateTasteShowLibrary
            .updateMany({
              where: {
                plexUserId,
                librarySectionKey: tvSectionKey,
                profileId: selection.collectionProfile.profileId,
                tvdbId: { in: activeTvdbIds },
              },
              data: { downloadApproval: 'none' },
            })
            .catch(() => undefined);
        }
      }

      if (missingTvdbIds.length) {
        for (const selection of showCollectionSelections) {
          if (approvalRequiredFromObservatory) {
            await this.prisma.immaculateTasteShowLibrary
              .updateMany({
                where: {
                  plexUserId,
                  librarySectionKey: tvSectionKey,
                  profileId: selection.collectionProfile.profileId,
                  status: 'pending',
                  tvdbId: { in: missingTvdbIds },
                  downloadApproval: 'none',
                },
                data: { downloadApproval: 'pending' },
              })
              .catch(() => undefined);
          } else {
            await this.prisma.immaculateTasteShowLibrary
              .updateMany({
                where: {
                  plexUserId,
                  librarySectionKey: tvSectionKey,
                  profileId: selection.collectionProfile.profileId,
                  status: 'pending',
                  tvdbId: { in: missingTvdbIds },
                  downloadApproval: 'pending',
                },
                data: { downloadApproval: 'none' },
              })
              .catch(() => undefined);
          }
        }
      }

      if (sonarrSentTvdbIds.length) {
        for (const selection of showCollectionSelections) {
          await this.prisma.immaculateTasteShowLibrary
            .updateMany({
              where: {
                plexUserId,
                librarySectionKey: tvSectionKey,
                profileId: selection.collectionProfile.profileId,
                tvdbId: { in: sonarrSentTvdbIds },
                sentToSonarrAt: null,
              },
              data: { sentToSonarrAt: now },
            })
            .catch(() => undefined);
        }
      }
    }

    // --- Optional chained refresher ---
    const refresherByProfile: Array<{
      profileId: string;
      profileDatasetId: string;
      profileName: string;
      collectionProfileId: string;
      refresher: JsonObject | null;
    }> = [];
    let refresherSummary: JsonObject | null = null;
    if (!includeRefresherAfterUpdate) {
      const skippedRefresherSummary: JsonObject = {
        skipped: true,
        reason: 'disabled',
      };
      refresherSummary = skippedRefresherSummary;
      await ctx.info(
        'immaculateTastePoints(tv): refresher skipped (disabled)',
        {
          includeRefresherAfterUpdate,
        },
      );
      for (const selection of showCollectionSelections) {
        refresherByProfile.push({
          profileId: selection.profile.id,
          profileDatasetId: selection.profile.datasetId,
          profileName: selection.profile.name,
          collectionProfileId: selection.collectionProfile.profileId,
          refresher: skippedRefresherSummary,
        });
      }
    } else if (ctx.dryRun) {
      const skippedRefresherSummary: JsonObject = {
        skipped: true,
        reason: 'dry_run',
      };
      refresherSummary = skippedRefresherSummary;
      await ctx.info('immaculateTastePoints(tv): refresher skipped (dryRun)', {
        includeRefresherAfterUpdate,
      });
      for (const selection of showCollectionSelections) {
        refresherByProfile.push({
          profileId: selection.profile.id,
          profileDatasetId: selection.profile.datasetId,
          profileName: selection.profile.name,
          collectionProfileId: selection.collectionProfile.profileId,
          refresher: skippedRefresherSummary,
        });
      }
    } else {
      await ctx.info('immaculateTastePoints(tv): running refresher (chained)', {
        jobId: 'immaculateTasteRefresher',
        targets: showCollectionSelections.length,
      });
      void ctx
        .patchSummary({
          progress: {
            step: 'plex_collection_sync',
            message: 'Refreshing Plex collection…',
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
      for (const selection of showCollectionSelections) {
        try {
          const refresherResult = await this.immaculateTasteRefresher.run({
            ...ctx,
            input: {
              ...(ctx.input ?? {}),
              plexUserId,
              plexUserTitle,
              pinCollections: true,
              pinTarget,
              includeMovies: false,
              includeTv: true,
              tvSectionKey,
              tvLibraryName,
              profileId: selection.collectionProfile.profileId,
              tvCollectionBaseName:
                selection.profile.showCollectionBaseName ?? null,
            },
          });
          const profileRefresherSummary =
            (refresherResult.summary as JsonObject | null) ?? null;
          refresherByProfile.push({
            profileId: selection.profile.id,
            profileDatasetId: selection.profile.datasetId,
            profileName: selection.profile.name,
            collectionProfileId: selection.collectionProfile.profileId,
            refresher: profileRefresherSummary,
          });
          if (refresherSummary === null) {
            refresherSummary = profileRefresherSummary;
          }
          await ctx.info(
            'immaculateTastePoints(tv): refresher done (chained)',
            {
              profileId: selection.profile.id,
              profileDatasetId: selection.profile.datasetId,
              collectionProfileId: selection.collectionProfile.profileId,
              refresher: profileRefresherSummary,
            },
          );
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          const failedRefresherSummary: JsonObject = { error: msg };
          refresherByProfile.push({
            profileId: selection.profile.id,
            profileDatasetId: selection.profile.datasetId,
            profileName: selection.profile.name,
            collectionProfileId: selection.collectionProfile.profileId,
            refresher: failedRefresherSummary,
          });
          if (refresherSummary === null) {
            refresherSummary = failedRefresherSummary;
          }
          await ctx.warn(
            'immaculateTastePoints(tv): refresher failed (continuing)',
            {
              profileId: selection.profile.id,
              profileDatasetId: selection.profile.datasetId,
              collectionProfileId: selection.collectionProfile.profileId,
              error: msg,
            },
          );
        }
      }
    }

    const summary: JsonObject = {
      mediaType: 'tv',
      plexUserId,
      plexUserTitle,
      seedTitle,
      seedYear,
      seedGenres,
      seedAudioLanguages,
      profile: {
        id: matchedProfile.id,
        datasetId: matchedProfile.datasetId,
        name: matchedProfile.name,
        sonarrInstanceId: matchedProfile.sonarrInstanceId ?? null,
        showCollectionBaseName: matchedProfile.showCollectionBaseName ?? null,
      },
      collectionProfile: {
        datasetId: profileId,
        source: showCollectionProfile.fallbackToDefault
          ? 'default_collection_fallback'
          : 'matched_profile',
      },
      matchedProfiles: matchedShowProfiles.map((selection) => ({
        id: selection.profile.id,
        datasetId: selection.profile.datasetId,
        name: selection.profile.name,
        mediaType: selection.profile.mediaType,
        matchMode: selection.profile.matchMode,
        includeGenres: selection.profile.genres,
        includeAudioLanguages: selection.profile.audioLanguages,
        excludedGenres: selection.profile.excludedGenres,
        excludedAudioLanguages: selection.profile.excludedAudioLanguages,
        collectionProfile: {
          datasetId: selection.collectionProfile.profileId,
          source: selection.collectionProfile.fallbackToDefault
            ? 'default_collection_fallback'
            : 'matched_profile',
        },
      })),
      sonarrInstance: resolvedSonarrInstance
        ? {
            id: resolvedSonarrInstance.id,
            name: resolvedSonarrInstance.name,
            isPrimary: resolvedSonarrInstance.isPrimary,
            enabled: resolvedSonarrInstance.enabled,
            baseUrl: resolvedSonarrInstance.baseUrl || null,
          }
        : null,
      profileMatch: {
        matched: true,
        reason: 'matched_profile',
        seedMediaType: 'show',
        profileId: matchedProfile.id,
        profileDatasetId: matchedProfile.datasetId,
        profileName: matchedProfile.name,
        profileMediaType: matchedProfile.mediaType,
        profileMatchMode: matchedProfile.matchMode,
        includeGenres: matchedProfile.genres,
        includeAudioLanguages: matchedProfile.audioLanguages,
        excludedGenres: matchedProfile.excludedGenres,
        excludedAudioLanguages: matchedProfile.excludedAudioLanguages,
        matchedProfileCount: matchedShowProfiles.length,
        matchedProfileIds: matchedShowProfiles.map(
          (selection) => selection.profile.id,
        ),
        matchedProfileDatasetIds: matchedShowProfiles.map(
          (selection) => selection.profile.datasetId,
        ),
      },
      recommendationStrategy: recs.strategy,
      recommendationDebug: recs.debug,
      generated: generatedTitles.length,
      generatedTitles,
      resolvedInPlex: suggestedItems.length,
      resolvedTitles,
      missingInPlex: missingTitles.length,
      missingTitles,
      excludedByRejectListTitles: Array.from(
        new Set(
          excludedByRejectList
            .map((s) => String(s ?? '').trim())
            .filter(Boolean),
        ),
      ),
      excludedByRejectListCount: excludedByRejectList.length,
      approvalRequiredFromObservatory,
      seerrModeSelected,
      seerrConfiguredEnabled,
      seerr: seerrStats,
      seerrLists,
      sonarr: sonarrStats,
      sonarrLists,
      startSearchImmediately,
      points: pointsSummary,
      pointsByProfile,
      refresher: refresherSummary,
      refresherByProfile,
      sampleMissing: missingTitles.slice(0, 10),
      sampleResolved: suggestedItems.slice(0, 10).map((d) => d.title),
    };

    await ctx.info('immaculateTastePoints(tv): done', summary);
    const report = buildImmaculateTastePointsReport({ ctx, raw: summary });
    return { summary: report as unknown as JsonObject };
  }

  private async resolvePlexUserContext(ctx: JobContext) {
    const input = ctx.input ?? {};
    const admin = await this.plexUsers.ensureAdminPlexUser({
      userId: ctx.userId,
    });
    const plexUserIdRaw =
      typeof input['plexUserId'] === 'string' ? input['plexUserId'].trim() : '';
    const plexUserTitleRaw =
      typeof input['plexUserTitle'] === 'string'
        ? input['plexUserTitle'].trim()
        : '';
    const plexAccountIdRaw = input['plexAccountId'];
    const plexAccountId =
      typeof plexAccountIdRaw === 'number' && Number.isFinite(plexAccountIdRaw)
        ? Math.trunc(plexAccountIdRaw)
        : typeof plexAccountIdRaw === 'string' && plexAccountIdRaw.trim()
          ? Number.parseInt(plexAccountIdRaw.trim(), 10)
          : null;
    const plexAccountTitleRaw =
      typeof input['plexAccountTitle'] === 'string'
        ? input['plexAccountTitle'].trim()
        : '';
    const plexAccountTitle = plexAccountTitleRaw || plexUserTitleRaw;

    const fromInput = plexUserIdRaw
      ? await this.plexUsers.getPlexUserById(plexUserIdRaw)
      : null;
    const normalize = (value: string | null | undefined) =>
      String(value ?? '')
        .trim()
        .toLowerCase();
    const isAdminUser = (row: {
      id: string;
      plexAccountId: number | null;
      plexAccountTitle: string;
      isAdmin?: boolean;
    }) => {
      if (row.id === admin.id) return true;
      if (
        row.plexAccountId !== null &&
        admin.plexAccountId !== null &&
        row.plexAccountId === admin.plexAccountId
      ) {
        return true;
      }
      const rowTitle = normalize(row.plexAccountTitle);
      const adminTitle = normalize(admin.plexAccountTitle);
      if (rowTitle && adminTitle && rowTitle === adminTitle) return true;
      return row.isAdmin === true;
    };
    if (fromInput) {
      return {
        plexUserId: fromInput.id,
        plexUserTitle: fromInput.plexAccountTitle,
        pinCollections: isAdminUser(fromInput),
      };
    }

    if (plexAccountTitle) {
      const byTitle = await this.plexUsers.getOrCreateByPlexAccount({
        plexAccountTitle,
      });
      if (byTitle) {
        return {
          plexUserId: byTitle.id,
          plexUserTitle: byTitle.plexAccountTitle,
          pinCollections: isAdminUser(byTitle),
        };
      }
    }

    if (plexAccountId) {
      const byAccount = await this.plexUsers.getOrCreateByPlexAccount({
        plexAccountId,
        plexAccountTitle,
      });
      if (byAccount) {
        return {
          plexUserId: byAccount.id,
          plexUserTitle: byAccount.plexAccountTitle,
          pinCollections: isAdminUser(byAccount),
        };
      }
    }

    return {
      plexUserId: admin.id,
      plexUserTitle: admin.plexAccountTitle,
      pinCollections: true,
    };
  }

  private async validateSonarrTvdbId(params: {
    ctx: JobContext;
    baseUrl: string;
    apiKey: string;
    tvdbId: number;
    cache: Map<number, boolean | null>;
  }): Promise<boolean | null> {
    const tvdbId = Math.trunc(params.tvdbId);
    if (!Number.isFinite(tvdbId) || tvdbId <= 0) return false;

    if (params.cache.has(tvdbId)) {
      return params.cache.get(tvdbId) ?? null;
    }

    const lookup = await withJobRetryOrNull(
      () =>
        this.sonarr.lookupSeries({
          baseUrl: params.baseUrl,
          apiKey: params.apiKey,
          term: `tvdb:${tvdbId}`,
        }),
      {
        ctx: params.ctx,
        label: 'sonarr: lookup tvdb precheck',
        meta: { tvdbId },
      },
    );

    if (!lookup) {
      params.cache.set(tvdbId, null);
      return null;
    }

    const hasMatch = lookup.some((series) => {
      const raw = series?.tvdbId;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.trunc(raw) === tvdbId;
      }
      return false;
    });

    params.cache.set(tvdbId, hasMatch);
    return hasMatch;
  }

  private async validateRadarrTmdbId(params: {
    ctx: JobContext;
    baseUrl: string;
    apiKey: string;
    tmdbId: number;
    cache: Map<number, boolean | null>;
  }): Promise<boolean | null> {
    const tmdbId = Math.trunc(params.tmdbId);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return false;

    if (params.cache.has(tmdbId)) {
      return params.cache.get(tmdbId) ?? null;
    }

    const lookup = await withJobRetryOrNull(
      () =>
        this.radarr.lookupMovies({
          baseUrl: params.baseUrl,
          apiKey: params.apiKey,
          term: `tmdb:${tmdbId}`,
        }),
      {
        ctx: params.ctx,
        label: 'radarr: lookup tmdb precheck',
        meta: { tmdbId },
      },
    );

    if (!lookup) {
      params.cache.set(tmdbId, null);
      return null;
    }

    const hasMatch = lookup.some((movie) => {
      const raw = movie?.tmdbId;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.trunc(raw) === tmdbId;
      }
      return false;
    });

    params.cache.set(tmdbId, hasMatch);
    return hasMatch;
  }

  private async pickRadarrDefaults(params: {
    ctx: JobContext;
    baseUrl: string;
    apiKey: string;
    preferredRootFolderPath?: string;
    preferredQualityProfileId?: number;
    preferredTagId?: number | null;
  }): Promise<{
    rootFolderPath: string;
    qualityProfileId: number;
    tagIds: number[];
  }> {
    const { ctx, baseUrl, apiKey } = params;

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.radarr.listRootFolders({ baseUrl, apiKey }),
      this.radarr.listQualityProfiles({ baseUrl, apiKey }),
      this.radarr.listTags({ baseUrl, apiKey }),
    ]);

    if (!rootFolders.length)
      throw new Error('Radarr has no root folders configured');
    if (!qualityProfiles.length)
      throw new Error('Radarr has no quality profiles configured');

    const preferredRoot = (params.preferredRootFolderPath ?? '').trim();
    const rootFolder = preferredRoot
      ? (rootFolders.find((r) => r.path === preferredRoot) ?? rootFolders[0])
      : rootFolders[0];

    const desiredQualityId = Math.max(
      1,
      Math.trunc(params.preferredQualityProfileId ?? 1),
    );
    const qualityProfile =
      qualityProfiles.find((p) => p.id === desiredQualityId) ??
      (desiredQualityId !== 1
        ? qualityProfiles.find((p) => p.id === 1)
        : null) ??
      qualityProfiles[0];

    const preferredTagId =
      typeof params.preferredTagId === 'number' &&
      Number.isFinite(params.preferredTagId)
        ? Math.trunc(params.preferredTagId)
        : null;
    const tag = preferredTagId
      ? tags.find((t) => t.id === preferredTagId)
      : null;

    const rootFolderPath = rootFolder.path;
    const qualityProfileId = qualityProfile.id;
    const tagIds = tag ? [tag.id] : [];

    await ctx.info('radarr: defaults selected', {
      rootFolderPath,
      qualityProfileId,
      qualityProfileName: qualityProfile.name,
      tagIds,
      tagLabel: tag?.label ?? null,
      usedPreferredRootFolder: Boolean(
        preferredRoot && rootFolder.path === preferredRoot,
      ),
      usedPreferredQualityProfile: Boolean(
        qualityProfile.id === desiredQualityId,
      ),
      usedPreferredTag: Boolean(tag),
    });

    return { rootFolderPath, qualityProfileId, tagIds };
  }

  private async pickSonarrDefaults(params: {
    ctx: JobContext;
    baseUrl: string;
    apiKey: string;
    preferredRootFolderPath?: string;
    preferredQualityProfileId?: number;
    preferredTagId?: number | null;
  }): Promise<{
    rootFolderPath: string;
    qualityProfileId: number;
    tagIds: number[];
  }> {
    const { ctx, baseUrl, apiKey } = params;

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.sonarr.listRootFolders({ baseUrl, apiKey }),
      this.sonarr.listQualityProfiles({ baseUrl, apiKey }),
      this.sonarr.listTags({ baseUrl, apiKey }),
    ]);

    if (!rootFolders.length)
      throw new Error('Sonarr has no root folders configured');
    if (!qualityProfiles.length)
      throw new Error('Sonarr has no quality profiles configured');

    const preferredRoot = (params.preferredRootFolderPath ?? '').trim();
    const rootFolder = preferredRoot
      ? (rootFolders.find((r) => r.path === preferredRoot) ?? rootFolders[0])
      : rootFolders[0];

    const desiredQualityId = Math.max(
      1,
      Math.trunc(params.preferredQualityProfileId ?? 1),
    );
    const qualityProfile =
      qualityProfiles.find((p) => p.id === desiredQualityId) ??
      (desiredQualityId !== 1
        ? qualityProfiles.find((p) => p.id === 1)
        : null) ??
      qualityProfiles[0];

    const preferredTagId =
      typeof params.preferredTagId === 'number' &&
      Number.isFinite(params.preferredTagId)
        ? Math.trunc(params.preferredTagId)
        : null;
    const tag = preferredTagId
      ? tags.find((t) => t.id === preferredTagId)
      : null;

    const rootFolderPath = rootFolder.path;
    const qualityProfileId = qualityProfile.id;
    const tagIds = tag ? [tag.id] : [];

    await ctx.info('sonarr: defaults selected', {
      rootFolderPath,
      qualityProfileId,
      qualityProfileName: qualityProfile.name,
      tagIds,
      tagLabel: tag?.label ?? null,
      usedPreferredRootFolder: Boolean(
        preferredRoot && rootFolder.path === preferredRoot,
      ),
      usedPreferredQualityProfile: Boolean(
        qualityProfile.id === desiredQualityId,
      ),
      usedPreferredTag: Boolean(tag),
    });

    return { rootFolderPath, qualityProfileId, tagIds };
  }

  private async pickBestTmdbMatch(params: {
    tmdbApiKey: string;
    title: string;
  }): Promise<{
    tmdbId: number;
    title: string;
    year: number | null;
    vote_average: number | null;
    vote_count: number | null;
  } | null> {
    const results = await this.tmdb.searchMovie({
      apiKey: params.tmdbApiKey,
      query: params.title,
      includeAdult: false,
      year: null,
    });
    if (!results.length) return null;

    const q = params.title.trim().toLowerCase();
    const exact = results.find((r) => r.title.trim().toLowerCase() === q);
    const best = exact ?? results[0];
    const yearRaw = (best.release_date ?? '').slice(0, 4);
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;

    return {
      tmdbId: best.id,
      title: best.title,
      year: Number.isFinite(year) ? year : null,
      vote_average:
        typeof best.vote_average === 'number' &&
        Number.isFinite(best.vote_average)
          ? Number(best.vote_average)
          : null,
      vote_count:
        typeof best.vote_count === 'number' && Number.isFinite(best.vote_count)
          ? Math.max(0, Math.trunc(best.vote_count))
          : null,
    };
  }

  private async pickBestTmdbTvMatch(params: {
    ctx: JobContext;
    tmdbApiKey: string;
    title: string;
  }): Promise<{
    tmdbId: number;
    tvdbId: number | null;
    title: string;
    year: number | null;
    vote_average: number | null;
    vote_count: number | null;
  } | null> {
    const results = await withJobRetryOrNull(
      () =>
        this.tmdb.searchTv({
          apiKey: params.tmdbApiKey,
          query: params.title,
          includeAdult: false,
          firstAirDateYear: null,
        }),
      {
        ctx: params.ctx,
        label: 'tmdb: search tv',
        meta: { title: params.title },
      },
    );
    if (!results?.length) return null;

    const q = params.title.trim().toLowerCase();
    const exact = results.find((r) => r.name.trim().toLowerCase() === q);
    const best = exact ?? results[0];

    const details = await withJobRetryOrNull(
      () =>
        this.tmdb.getTv({
          apiKey: params.tmdbApiKey,
          tmdbId: best.id,
          appendExternalIds: true,
        }),
      {
        ctx: params.ctx,
        label: 'tmdb: get tv details',
        meta: { tmdbId: best.id },
      },
    );

    const tvdbIdRaw = details?.external_ids?.tvdb_id ?? null;
    const tvdbId =
      typeof tvdbIdRaw === 'number' && Number.isFinite(tvdbIdRaw)
        ? Math.trunc(tvdbIdRaw)
        : null;

    const yearRaw = (
      details?.first_air_date ??
      best.first_air_date ??
      ''
    ).slice(0, 4);
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;

    const voteAverageRaw = details?.vote_average ?? best.vote_average ?? null;
    const voteCountRaw = details?.vote_count ?? best.vote_count ?? null;

    const vote_average =
      typeof voteAverageRaw === 'number' && Number.isFinite(voteAverageRaw)
        ? Number(voteAverageRaw)
        : null;
    const vote_count =
      typeof voteCountRaw === 'number' && Number.isFinite(voteCountRaw)
        ? Math.max(0, Math.trunc(voteCountRaw))
        : null;

    return {
      tmdbId: best.id,
      tvdbId,
      title: details?.name ?? best.name,
      year: Number.isFinite(year) ? year : null,
      vote_average,
      vote_count,
    };
  }
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function buildImmaculateTastePointsReport(params: {
  ctx: JobContext;
  raw: JsonObject;
}): JobReportV1 {
  const { ctx, raw } = params;

  const asStringArray = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  };
  const asTrimmedString = (v: unknown): string =>
    typeof v === 'string' ? v.trim() : '';
  const uniqueStrings = (arr: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of arr) {
      const v = String(s ?? '').trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  };
  const sortTitles = (arr: string[]) =>
    arr
      .slice()
      .sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }),
      );

  const radarr = isPlainObject(raw.radarr) ? raw.radarr : null;
  const sonarr = isPlainObject(raw.sonarr) ? raw.sonarr : null;
  const seerr = isPlainObject(raw.seerr) ? raw.seerr : null;
  const points = isPlainObject(raw.points) ? raw.points : null;

  const generated = asNum(raw.generated) ?? 0;
  const resolvedInPlex = asNum(raw.resolvedInPlex) ?? 0;
  const missingInPlex = asNum(raw.missingInPlex) ?? 0;

  const totalBefore = points ? asNum(points.totalBefore) : null;
  const totalAfter = points ? asNum(points.totalAfter) : null;
  const activeBefore = points ? asNum(points.totalActiveBefore) : null;
  const activeAfter = points ? asNum(points.totalActiveAfter) : null;
  const pendingBefore = points ? asNum(points.totalPendingBefore) : null;
  const pendingAfter = points ? asNum(points.totalPendingAfter) : null;

  const radarrFailed = radarr ? (asNum(radarr.failed) ?? 0) : 0;
  const sonarrFailed = sonarr ? (asNum(sonarr.failed) ?? 0) : 0;
  const seerrFailed = seerr ? (asNum(seerr.failed) ?? 0) : 0;

  const refresher = raw.refresher;
  const refresherObj =
    refresher && typeof refresher === 'object' && !Array.isArray(refresher)
      ? (refresher as Record<string, unknown>)
      : null;
  const refresherSkipped =
    refresherObj && typeof refresherObj.skipped === 'boolean'
      ? refresherObj.skipped
      : null;
  const refresherReason =
    refresherObj && typeof refresherObj.reason === 'string'
      ? refresherObj.reason
      : null;
  const refresherError =
    refresherObj && typeof refresherObj.error === 'string'
      ? refresherObj.error.trim()
      : null;
  const refresherCollectionFacts: Array<{ label: string; value: JsonValue }> =
    [];
  const refresherRaw =
    refresherObj &&
    refresherObj.template === 'jobReportV1' &&
    isPlainObject(refresherObj.raw)
      ? refresherObj.raw
      : null;
  const appendRefresherCollectionFacts = (
    side: Record<string, unknown> | null,
    labelPrefix: string,
    unit: string,
  ) => {
    const byLibraryRaw = side?.plexByLibrary;
    const byLibrary = Array.isArray(byLibraryRaw)
      ? byLibraryRaw.filter(
          (x): x is Record<string, unknown> =>
            Boolean(x) && typeof x === 'object' && !Array.isArray(x),
        )
      : [];
    for (const lib of byLibrary) {
      const libraryLabel = String(lib.library ?? lib.title ?? 'Library').trim();
      const plex = isPlainObject(lib.plex) ? lib.plex : null;
      const collectionItemsSource = plex
        ? String(plex.collectionItemsSource ?? '').trim()
        : '';
      const plexItems = plex ? asStringArray(plex.collectionItems) : [];
      if (!plexItems.length) continue;
      const label = libraryLabel
        ? `${labelPrefix} — ${libraryLabel}`
        : labelPrefix;
      refresherCollectionFacts.push({
        label,
        value: {
          count: plexItems.length,
          unit,
          items: plexItems,
          order:
            collectionItemsSource === 'desired_fallback'
              ? 'desired_fallback'
              : 'plex',
        },
      });
    }
  };
  if (refresherRaw) {
    const movieSide = isPlainObject(refresherRaw.movie)
      ? refresherRaw.movie
      : null;
    const tvSide = isPlainObject(refresherRaw.tv) ? refresherRaw.tv : null;
    appendRefresherCollectionFacts(movieSide, 'Movie collection', 'movies');
    appendRefresherCollectionFacts(tvSide, 'TV collection', 'shows');
  }

  const issues = [
    ...(seerrFailed
      ? [issue('warn', `Seerr: ${seerrFailed} request(s) failed.`)]
      : []),
    ...(radarrFailed
      ? [issue('warn', `Radarr: ${radarrFailed} add(s) failed.`)]
      : []),
    ...(sonarrFailed
      ? [issue('warn', `Sonarr: ${sonarrFailed} add(s) failed.`)]
      : []),
    ...(refresherError
      ? [issue('error', `Refresher failed: ${refresherError}`)]
      : []),
  ];

  const rawMediaType = String((raw as Record<string, unknown>).mediaType ?? '')
    .trim()
    .toLowerCase();
  const normalizedMediaType =
    rawMediaType === 'tv' || rawMediaType === 'movie' ? rawMediaType : '';
  const mode: 'tv' | 'movie' =
    (normalizedMediaType || (sonarr ? 'tv' : 'movie')) === 'tv'
      ? 'tv'
      : 'movie';
  const rawWithMediaType = { ...raw, mediaType: mode } as JsonObject;
  const skipped = raw.skipped === true;
  const skipReason = asTrimmedString(raw.reason);
  const normalizeTitle = (value: string) =>
    String(value ?? '')
      .trim()
      .toLowerCase();
  const generatedTitles = sortTitles(
    uniqueStrings(asStringArray(raw.generatedTitles)),
  );
  const resolvedTitles = sortTitles(
    uniqueStrings(asStringArray(raw.resolvedTitles)),
  );
  const missingTitles = sortTitles(
    uniqueStrings(asStringArray(raw.missingTitles)),
  );
  const excludedByRejectListTitles = sortTitles(
    uniqueStrings(asStringArray(raw.excludedByRejectListTitles)),
  );
  const excludedByRejectListCount =
    asNum(raw.excludedByRejectListCount) ?? excludedByRejectListTitles.length;
  const seedTitle = String(raw.seedTitle ?? '').trim();
  const plexUserId = String(raw.plexUserId ?? '').trim();
  const plexUserTitle = String(raw.plexUserTitle ?? '').trim();
  const seedGenres = sortTitles(uniqueStrings(asStringArray(raw.seedGenres)));
  const seedAudioLanguages = sortTitles(
    uniqueStrings(asStringArray(raw.seedAudioLanguages)),
  );
  const profile = isPlainObject(raw.profile)
    ? (raw.profile as Record<string, unknown>)
    : null;
  const profileName = profile ? asTrimmedString(profile.name) : '';
  const profileDatasetId = profile ? asTrimmedString(profile.datasetId) : '';
  const profileInternalId = profile ? asTrimmedString(profile.id) : '';
  const profileRadarrInstanceId = profile
    ? asTrimmedString(profile.radarrInstanceId)
    : '';
  const profileSonarrInstanceId = profile
    ? asTrimmedString(profile.sonarrInstanceId)
    : '';
  const collectionProfileRaw = isPlainObject(raw.collectionProfile)
    ? (raw.collectionProfile as Record<string, unknown>)
    : null;
  const collectionProfileDatasetId = collectionProfileRaw
    ? asTrimmedString(collectionProfileRaw.datasetId)
    : '';
  const collectionProfileSource = collectionProfileRaw
    ? asTrimmedString(collectionProfileRaw.source)
    : '';
  const matchedProfileLabel =
    profileName || profileDatasetId || profileInternalId;
  const radarrInstanceRaw = isPlainObject(raw.radarrInstance)
    ? (raw.radarrInstance as Record<string, unknown>)
    : null;
  const sonarrInstanceRaw = isPlainObject(raw.sonarrInstance)
    ? (raw.sonarrInstance as Record<string, unknown>)
    : null;
  const formatArrInstanceValue = (
    instance: Record<string, unknown> | null,
    fallbackId: string,
  ): string => {
    if (!instance && !fallbackId) return '';
    const name = instance ? asTrimmedString(instance.name) : '';
    const id = instance ? asTrimmedString(instance.id) : fallbackId;
    const baseUrl = instance ? asTrimmedString(instance.baseUrl) : '';
    const isPrimary =
      instance && typeof instance['isPrimary'] === 'boolean'
        ? instance['isPrimary']
        : null;
    const enabled =
      instance && typeof instance['enabled'] === 'boolean'
        ? instance['enabled']
        : null;

    const title = name || id || fallbackId;
    if (!title) return '';

    const attrs: string[] = [];
    if (id && name && id !== name) attrs.push(`id: ${id}`);
    if (isPrimary === true) attrs.push('primary');
    if (isPrimary === false) attrs.push('additional');
    if (enabled === true) attrs.push('enabled');
    if (enabled === false) attrs.push('disabled');
    if (baseUrl) attrs.push(baseUrl);
    return attrs.length ? `${title} (${attrs.join(', ')})` : title;
  };
  const radarrContextValue =
    radarrInstanceRaw || Boolean(radarr?.enabled)
      ? formatArrInstanceValue(radarrInstanceRaw, profileRadarrInstanceId)
      : '';
  const sonarrContextValue =
    sonarrInstanceRaw || Boolean(sonarr?.enabled)
      ? formatArrInstanceValue(sonarrInstanceRaw, profileSonarrInstanceId)
      : '';
  const profileMatchRaw = isPlainObject(raw.profileMatch)
    ? (raw.profileMatch as Record<string, unknown>)
    : null;
  const profileMatchMatched =
    profileMatchRaw && typeof profileMatchRaw.matched === 'boolean'
      ? profileMatchRaw.matched
      : Boolean(matchedProfileLabel);
  const profileMatchReason = profileMatchRaw
    ? asTrimmedString(profileMatchRaw.reason)
    : profileMatchMatched
      ? 'matched_profile'
      : '';
  const profileMatchSeedMediaType = profileMatchRaw
    ? asTrimmedString(profileMatchRaw.seedMediaType)
    : mode === 'tv'
      ? 'show'
      : 'movie';
  const profileMatchSkippedStages = sortTitles(
    uniqueStrings(asStringArray(profileMatchRaw?.skippedStages)),
  );
  const profileMatchMode = profileMatchRaw
    ? asTrimmedString(profileMatchRaw.profileMatchMode)
    : '';
  const profileMatchMediaType = profileMatchRaw
    ? asTrimmedString(profileMatchRaw.profileMediaType)
    : '';
  const profileMatchIncludeGenres = sortTitles(
    uniqueStrings(asStringArray(profileMatchRaw?.includeGenres)),
  );
  const profileMatchIncludeAudioLanguages = sortTitles(
    uniqueStrings(asStringArray(profileMatchRaw?.includeAudioLanguages)),
  );
  const profileMatchExcludedGenres = sortTitles(
    uniqueStrings(asStringArray(profileMatchRaw?.excludedGenres)),
  );
  const profileMatchExcludedAudioLanguages = sortTitles(
    uniqueStrings(asStringArray(profileMatchRaw?.excludedAudioLanguages)),
  );
  const contextFacts: Array<{ label: string; value: JsonValue }> = [];
  if (plexUserTitle)
    contextFacts.push({ label: 'Plex user', value: plexUserTitle });
  if (plexUserId)
    contextFacts.push({ label: 'Plex user id', value: plexUserId });
  if (matchedProfileLabel) {
    contextFacts.push({
      label: 'Matched Immaculate Taste profile',
      value: matchedProfileLabel,
    });
  }
  if (profileDatasetId) {
    contextFacts.push({ label: 'Profile dataset id', value: profileDatasetId });
  }
  if (profileInternalId) {
    contextFacts.push({ label: 'Profile id', value: profileInternalId });
  }
  if (collectionProfileDatasetId) {
    contextFacts.push({
      label: 'Collection dataset profile id',
      value: collectionProfileDatasetId,
    });
  }
  if (collectionProfileSource) {
    contextFacts.push({
      label: 'Collection dataset source',
      value: collectionProfileSource,
    });
  }
  if (radarrContextValue) {
    contextFacts.push({
      label: 'Radarr instance used',
      value: radarrContextValue,
    });
  }
  if (sonarrContextValue) {
    contextFacts.push({
      label: 'Sonarr instance used',
      value: sonarrContextValue,
    });
  }
  contextFacts.push({
    label: 'Profile match result',
    value: profileMatchMatched ? 'matched' : 'no_match',
  });
  if (profileMatchReason) {
    contextFacts.push({
      label: 'Profile match reason',
      value: profileMatchReason,
    });
  }
  contextFacts.push({
    label: 'Seed genres',
    value: {
      count: seedGenres.length,
      unit: 'genres',
      items: seedGenres,
    },
  });
  contextFacts.push({
    label: 'Seed audio languages',
    value: {
      count: seedAudioLanguages.length,
      unit: 'languages',
      items: seedAudioLanguages,
    },
  });
  const profileMatchingFacts: Array<{ label: string; value: JsonValue }> = [
    { label: 'Matched', value: profileMatchMatched },
    {
      label: 'Seed media type',
      value: profileMatchSeedMediaType || (mode === 'tv' ? 'show' : 'movie'),
    },
    { label: 'Reason', value: profileMatchReason || null },
    {
      label: 'Seed genres',
      value: {
        count: seedGenres.length,
        unit: 'genres',
        items: seedGenres,
      },
    },
    {
      label: 'Seed audio languages',
      value: {
        count: seedAudioLanguages.length,
        unit: 'languages',
        items: seedAudioLanguages,
      },
    },
    {
      label: 'Skipped stages',
      value: {
        count: profileMatchSkippedStages.length,
        unit: 'stages',
        items: profileMatchSkippedStages,
      },
    },
  ];
  if (profileMatchMatched) {
    profileMatchingFacts.push(
      { label: 'Profile match mode', value: profileMatchMode || null },
      { label: 'Profile media type', value: profileMatchMediaType || null },
      {
        label: 'Profile include genres',
        value: {
          count: profileMatchIncludeGenres.length,
          unit: 'genres',
          items: profileMatchIncludeGenres,
        },
      },
      {
        label: 'Profile include audio languages',
        value: {
          count: profileMatchIncludeAudioLanguages.length,
          unit: 'languages',
          items: profileMatchIncludeAudioLanguages,
        },
      },
      {
        label: 'Profile excluded genres',
        value: {
          count: profileMatchExcludedGenres.length,
          unit: 'genres',
          items: profileMatchExcludedGenres,
        },
      },
      {
        label: 'Profile excluded audio languages',
        value: {
          count: profileMatchExcludedAudioLanguages.length,
          unit: 'languages',
          items: profileMatchExcludedAudioLanguages,
        },
      },
    );
  }
  const profileMatchingTask = {
    id: 'profile_matching',
    title: 'Profile matching',
    status: profileMatchMatched ? ('success' as const) : ('skipped' as const),
    facts: profileMatchingFacts,
    issues:
      profileMatchMatched || !profileMatchReason
        ? undefined
        : [
            issue(
              'warn',
              `Profile matching skipped downstream pipeline: ${profileMatchReason}`,
            ),
          ],
  };

  const radarrLists = isPlainObject(raw.radarrLists) ? raw.radarrLists : null;
  const sonarrLists = isPlainObject(raw.sonarrLists) ? raw.sonarrLists : null;
  const seerrLists = isPlainObject(raw.seerrLists) ? raw.seerrLists : null;

  const recommendationDebug = isPlainObject(raw.recommendationDebug)
    ? (raw.recommendationDebug as Record<string, unknown>)
    : null;
  const recommendationUsed =
    recommendationDebug && isPlainObject(recommendationDebug.used)
      ? recommendationDebug.used
      : null;

  const recommendationStrategyRaw = String(raw.recommendationStrategy ?? '')
    .trim()
    .toLowerCase();
  const recommendationStrategy =
    recommendationStrategyRaw ||
    (recommendationUsed?.openai ? 'openai' : 'tmdb');

  const googleEnabled = Boolean(recommendationDebug?.googleEnabled);
  const openAiEnabled = Boolean(recommendationDebug?.openAiEnabled);
  const googleUsed = Boolean(recommendationUsed?.google);

  const googleSuggestedTitles = sortTitles(
    uniqueStrings(asStringArray(recommendationDebug?.googleSuggestedTitles)),
  );
  const openAiSuggestedTitles = sortTitles(
    uniqueStrings(asStringArray(recommendationDebug?.openAiSuggestedTitles)),
  );
  const tmdbSuggestedTitles = sortTitles(
    uniqueStrings(asStringArray(recommendationDebug?.tmdbSuggestedTitles)),
  );

  const recommendationFacts: Array<{ label: string; value: JsonValue }> = [];
  recommendationFacts.push(
    { label: 'Seed', value: seedTitle },
    { label: 'Seed year', value: asNum(raw.seedYear) },
    {
      label: 'Google',
      value: !googleEnabled
        ? 'Not enabled'
        : googleUsed
          ? {
              count: googleSuggestedTitles.length,
              unit: mode === 'tv' ? 'shows' : 'movies',
              items: googleSuggestedTitles,
            }
          : 'Skipped',
    },
    {
      label: 'OpenAI',
      value: !openAiEnabled
        ? 'Not enabled'
        : recommendationStrategy === 'openai'
          ? {
              count: (openAiSuggestedTitles.length
                ? openAiSuggestedTitles
                : generatedTitles
              ).length,
              unit: mode === 'tv' ? 'shows' : 'movies',
              items: openAiSuggestedTitles.length
                ? openAiSuggestedTitles
                : generatedTitles,
            }
          : 'Skipped',
    },
    {
      label: 'TMDB',
      value:
        recommendationStrategy === 'tmdb'
          ? {
              count: (tmdbSuggestedTitles.length
                ? tmdbSuggestedTitles
                : generatedTitles
              ).length,
              unit: mode === 'tv' ? 'shows' : 'movies',
              items: tmdbSuggestedTitles.length
                ? tmdbSuggestedTitles
                : generatedTitles,
            }
          : 'Skipped',
    },
    {
      label: 'Generated',
      value: {
        count: generated,
        unit: mode === 'tv' ? 'shows' : 'movies',
        items: generatedTitles,
      },
    },
    { label: 'Strategy', value: String(raw.recommendationStrategy ?? '') },
  );

  const finalCollectionTitles = uniqueStrings(
    refresherCollectionFacts.flatMap((fact) => {
      if (!isPlainObject(fact.value)) return [];
      return asStringArray((fact.value as Record<string, unknown>).items);
    }),
  );
  const finalCollectionTitleSet = new Set(
    finalCollectionTitles.map((title) => normalizeTitle(title)),
  );
  const resolvedMissingFromFinal = finalCollectionTitleSet.size
    ? resolvedTitles.filter(
        (title) => !finalCollectionTitleSet.has(normalizeTitle(title)),
      )
    : [];
  if (resolvedMissingFromFinal.length) {
    issues.push(
      issue(
        'warn',
        `${resolvedMissingFromFinal.length} resolved title(s) were not found in the final chained collection snapshot.`,
      ),
    );
  }
  const usedFallbackCollectionOrder = refresherCollectionFacts.some((fact) => {
    if (!isPlainObject(fact.value)) return false;
    return (fact.value as Record<string, unknown>).order === 'desired_fallback';
  });
  if (usedFallbackCollectionOrder) {
    issues.push(
      issue(
        'warn',
        'Chained refresher order snapshot used desired fallback for at least one library.',
      ),
    );
  }

  if (skipped && skipReason === 'no_matching_profile') {
    const noMatchingProfileMessage =
      'No matching Immaculate Taste profile for the detected seed traits. The run was ignored.';
    const skippedStages = profileMatchSkippedStages.length
      ? profileMatchSkippedStages
      : ['recommendations', 'plex_resolve', 'points_update', 'refresher'];
    const stageTitleMap: Record<string, string> = {
      recommendations: 'Generate recommendations',
      plex_resolve: 'Resolve titles in Plex',
      points_update: 'Update points dataset',
      refresher: 'Refresh Plex collection (chained)',
    };
    const skipTasks: JobReportV1['tasks'] = skippedStages.map((stageId) => ({
      id: stageId,
      title: stageTitleMap[stageId] ?? stageId,
      status: 'skipped',
      facts: [
        { label: 'Reason', value: skipReason },
        { label: 'Profile matching passed', value: false },
      ],
    }));
    if (contextFacts.length) {
      skipTasks.unshift({
        id: 'context',
        title: 'Context',
        status: 'success',
        facts: contextFacts,
      });
    }
    skipTasks.splice(contextFacts.length ? 1 : 0, 0, profileMatchingTask);
    return {
      template: 'jobReportV1',
      version: 1,
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      headline:
        mode === 'tv'
          ? seedTitle
            ? `Immaculate Taste (TV) ignored for ${seedTitle} (no matching profile).`
            : 'Immaculate Taste (TV) ignored (no matching profile).'
          : seedTitle
            ? `Immaculate Taste ignored for ${seedTitle} (no matching profile).`
            : 'Immaculate Taste ignored (no matching profile).',
      sections: [
        {
          id: 'totals',
          title: 'Totals',
          rows: [
            metricRow({
              label: 'Recommendations generated',
              end: 0,
              unit: 'titles',
            }),
            metricRow({ label: 'Resolved in Plex', end: 0, unit: 'items' }),
            metricRow({ label: 'Missing in Plex', end: 0, unit: 'titles' }),
          ],
        },
        {
          id: 'points',
          title: 'Points dataset',
          rows: [
            metricRow({ label: 'Rows (total)', end: null, unit: 'rows' }),
            metricRow({ label: 'Rows (active)', end: null, unit: 'rows' }),
            metricRow({ label: 'Rows (pending)', end: null, unit: 'rows' }),
            metricRow({ label: 'Created active', end: null, unit: 'rows' }),
            metricRow({ label: 'Created pending', end: null, unit: 'rows' }),
            metricRow({
              label: 'Activated from pending',
              end: null,
              unit: 'rows',
            }),
            metricRow({ label: 'Decayed', end: null, unit: 'rows' }),
            metricRow({ label: 'Removed', end: null, unit: 'rows' }),
          ],
        },
      ],
      tasks: skipTasks,
      issues: [...issues, issue('warn', noMatchingProfileMessage)],
      raw: rawWithMediaType,
    };
  }

  const tasks: JobReportV1['tasks'] = [
    {
      id: 'recommendations',
      title: 'Generate recommendations',
      status: 'success',
      facts: recommendationFacts,
    },
    {
      id: 'reject_list',
      title: 'Excluded by reject list',
      status: excludedByRejectListCount ? 'success' : 'skipped',
      facts: [
        {
          label: 'Excluded',
          value: {
            count: excludedByRejectListCount,
            unit: mode === 'tv' ? 'shows' : 'movies',
            items: excludedByRejectListTitles,
          },
        },
      ],
    },
    {
      id: 'plex_resolve',
      title: 'Resolve titles in Plex',
      status: 'success',
      facts: [
        {
          label: 'Resolved (this run)',
          value: {
            count: resolvedInPlex,
            unit: mode === 'tv' ? 'shows' : 'movies',
            items: resolvedTitles,
          },
        },
        {
          label: 'Missing',
          value: {
            count: missingInPlex,
            unit: mode === 'tv' ? 'shows' : 'movies',
            items: missingTitles,
          },
        },
      ],
    },
    ...(seerr
      ? [
          {
            id: 'seerr_request',
            title: 'Seerr: request missing titles',
            status:
              ctx.dryRun || !seerr.selected || !seerr.enabled
                ? ('skipped' as const)
                : seerrFailed
                  ? ('failed' as const)
                  : ('success' as const),
            facts: [
              { label: 'Selected', value: Boolean(seerr.selected) },
              { label: 'Configured', value: Boolean(seerr.enabled) },
              {
                label: 'Attempted',
                value: {
                  count: asNum(seerr.attempted),
                  unit: mode === 'tv' ? 'shows' : 'movies',
                  items: sortTitles(
                    uniqueStrings(
                      seerrLists ? asStringArray(seerrLists.attempted) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Requested',
                value: {
                  count: asNum(seerr.requested),
                  unit: mode === 'tv' ? 'shows' : 'movies',
                  items: sortTitles(
                    uniqueStrings(
                      seerrLists ? asStringArray(seerrLists.requested) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Exists',
                value: {
                  count: asNum(seerr.exists),
                  unit: mode === 'tv' ? 'shows' : 'movies',
                  items: sortTitles(
                    uniqueStrings(
                      seerrLists ? asStringArray(seerrLists.exists) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Failed',
                value: {
                  count: asNum(seerr.failed),
                  unit: mode === 'tv' ? 'shows' : 'movies',
                  items: sortTitles(
                    uniqueStrings(
                      seerrLists ? asStringArray(seerrLists.failed) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Skipped',
                value: {
                  count: asNum(seerr.skipped),
                  unit: mode === 'tv' ? 'shows' : 'movies',
                  items: sortTitles(
                    uniqueStrings(
                      seerrLists ? asStringArray(seerrLists.skipped) : [],
                    ),
                  ),
                },
              },
            ],
          },
        ]
      : []),
    ...(radarr
      ? [
          {
            id: 'radarr_add',
            title: 'Radarr: add missing movies',
            status:
              ctx.dryRun || !radarr.enabled
                ? ('skipped' as const)
                : ('success' as const),
            facts: [
              {
                label: 'Attempted',
                value: {
                  count: asNum(radarr.attempted),
                  unit: 'movies',
                  items: sortTitles(
                    uniqueStrings(
                      radarrLists ? asStringArray(radarrLists.attempted) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Added',
                value: {
                  count: asNum(radarr.added),
                  unit: 'movies',
                  items: sortTitles(
                    uniqueStrings(
                      radarrLists ? asStringArray(radarrLists.added) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Exists',
                value: {
                  count: asNum(radarr.exists),
                  unit: 'movies',
                  items: sortTitles(
                    uniqueStrings(
                      radarrLists ? asStringArray(radarrLists.exists) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Failed',
                value: {
                  count: asNum(radarr.failed),
                  unit: 'movies',
                  items: sortTitles(
                    uniqueStrings(
                      radarrLists ? asStringArray(radarrLists.failed) : [],
                    ),
                  ),
                },
              },
            ],
            issues:
              !ctx.dryRun && Boolean(radarr.enabled) && radarrFailed > 0
                ? [
                    issue(
                      'warn',
                      (() => {
                        const titles = sortTitles(
                          uniqueStrings(
                            radarrLists
                              ? asStringArray(radarrLists.failed)
                              : [],
                          ),
                        );
                        const suffix =
                          titles.length > 6
                            ? ` (examples: ${titles.slice(0, 6).join(', ')} +${titles.length - 6} more)`
                            : titles.length
                              ? ` (${titles.join(', ')})`
                              : '';
                        return `Radarr could not add ${radarrFailed} movie${radarrFailed === 1 ? '' : 's'}; continuing run.${suffix}`;
                      })(),
                    ),
                  ]
                : undefined,
          },
        ]
      : []),
    ...(sonarr
      ? [
          {
            id: 'sonarr_add',
            title: 'Sonarr: add missing series',
            status:
              ctx.dryRun || !sonarr.enabled
                ? ('skipped' as const)
                : ('success' as const),
            facts: [
              {
                label: 'Attempted',
                value: {
                  count: asNum(sonarr.attempted),
                  unit: 'shows',
                  items: sortTitles(
                    uniqueStrings(
                      sonarrLists ? asStringArray(sonarrLists.attempted) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Added',
                value: {
                  count: asNum(sonarr.added),
                  unit: 'shows',
                  items: sortTitles(
                    uniqueStrings(
                      sonarrLists ? asStringArray(sonarrLists.added) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Exists',
                value: {
                  count: asNum(sonarr.exists),
                  unit: 'shows',
                  items: sortTitles(
                    uniqueStrings(
                      sonarrLists ? asStringArray(sonarrLists.exists) : [],
                    ),
                  ),
                },
              },
              {
                label: 'Failed',
                value: {
                  count: asNum(sonarr.failed),
                  unit: 'shows',
                  items: sortTitles(
                    uniqueStrings(
                      sonarrLists ? asStringArray(sonarrLists.failed) : [],
                    ),
                  ),
                },
              },
            ],
            issues:
              !ctx.dryRun && Boolean(sonarr.enabled) && sonarrFailed > 0
                ? [
                    issue(
                      'warn',
                      (() => {
                        const titles = sortTitles(
                          uniqueStrings(
                            sonarrLists
                              ? asStringArray(sonarrLists.failed)
                              : [],
                          ),
                        );
                        const suffix =
                          titles.length > 6
                            ? ` (examples: ${titles.slice(0, 6).join(', ')} +${titles.length - 6} more)`
                            : titles.length
                              ? ` (${titles.join(', ')})`
                              : '';
                        return `Sonarr could not add ${sonarrFailed} show${sonarrFailed === 1 ? '' : 's'}; continuing run.${suffix}`;
                      })(),
                    ),
                  ]
                : undefined,
          },
        ]
      : []),
    {
      id: 'points_update',
      title: 'Update points dataset',
      status: ctx.dryRun ? 'skipped' : 'success',
      rows: [
        metricRow({
          label: 'Rows (total)',
          start: totalBefore,
          changed:
            totalBefore !== null && totalAfter !== null
              ? totalAfter - totalBefore
              : null,
          end: totalAfter,
          unit: 'rows',
        }),
      ],
    },
    {
      id: 'refresher',
      title: 'Refresh Plex collection (chained)',
      status: refresherError
        ? 'failed'
        : refresherSkipped === true
          ? 'skipped'
          : 'success',
      facts: [
        { label: 'skipped', value: refresherSkipped },
        { label: 'reason', value: refresherReason },
        ...(refresherError ? [{ label: 'error', value: refresherError }] : []),
        ...(finalCollectionTitleSet.size
          ? [
              {
                label: 'Resolved missing from final collection snapshot',
                value: {
                  count: resolvedMissingFromFinal.length,
                  unit: mode === 'tv' ? 'shows' : 'movies',
                  items: resolvedMissingFromFinal,
                },
              },
            ]
          : []),
        ...refresherCollectionFacts,
      ],
      issues: refresherError ? [issue('error', refresherError)] : undefined,
    },
  ];

  tasks.unshift(profileMatchingTask);

  if (contextFacts.length) {
    tasks.unshift({
      id: 'context',
      title: 'Context',
      status: 'success',
      facts: contextFacts,
    });
  }

  const withProfileHeadline = (base: string) =>
    matchedProfileLabel
      ? `${base} using profile "${matchedProfileLabel}".`
      : `${base}.`;

  return {
    template: 'jobReportV1',
    version: 1,
    jobId: ctx.jobId,
    dryRun: ctx.dryRun,
    trigger: ctx.trigger,
    headline:
      mode === 'tv'
        ? seedTitle
          ? withProfileHeadline(`Immaculate Taste (TV) updated by ${seedTitle}`)
          : withProfileHeadline('Immaculate Taste (TV) updated')
        : seedTitle
          ? withProfileHeadline(`Immaculate Taste updated by ${seedTitle}`)
          : withProfileHeadline('Immaculate Taste updated'),
    sections: [
      {
        id: 'totals',
        title: 'Totals',
        rows: [
          metricRow({
            label: 'Recommendations generated',
            end: generated,
            unit: 'titles',
          }),
          metricRow({
            label: 'Resolved in Plex',
            end: resolvedInPlex,
            unit: 'items',
          }),
          metricRow({
            label: 'Missing in Plex',
            end: missingInPlex,
            unit: 'titles',
          }),
        ],
      },
      {
        id: 'points',
        title: 'Points dataset',
        rows: [
          metricRow({
            label: 'Rows (total)',
            start: totalBefore,
            changed:
              totalBefore !== null && totalAfter !== null
                ? totalAfter - totalBefore
                : null,
            end: totalAfter,
            unit: 'rows',
          }),
          metricRow({
            label: 'Rows (active)',
            start: activeBefore,
            changed:
              activeBefore !== null && activeAfter !== null
                ? activeAfter - activeBefore
                : null,
            end: activeAfter,
            unit: 'rows',
          }),
          metricRow({
            label: 'Rows (pending)',
            start: pendingBefore,
            changed:
              pendingBefore !== null && pendingAfter !== null
                ? pendingAfter - pendingBefore
                : null,
            end: pendingAfter,
            unit: 'rows',
          }),
          metricRow({
            label: 'Created active',
            end: points ? asNum(points.createdActive) : null,
            unit: 'rows',
          }),
          metricRow({
            label: 'Created pending',
            end: points ? asNum(points.createdPending) : null,
            unit: 'rows',
          }),
          metricRow({
            label: 'Activated from pending',
            end: points ? asNum(points.activatedFromPending) : null,
            unit: 'rows',
          }),
          metricRow({
            label: 'Decayed',
            end: points ? asNum(points.decayed) : null,
            unit: 'rows',
          }),
          metricRow({
            label: 'Removed',
            end: points ? asNum(points.removed) : null,
            unit: 'rows',
          }),
        ],
      },
    ],
    tasks,
    issues,
    raw: rawWithMediaType,
  };
}
