import { Injectable } from '@nestjs/common';
import { GoogleService } from '../google/google.service';
import { OpenAiService } from '../openai/openai.service';
import { TmdbService } from '../tmdb/tmdb.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';

const RECS_MIN_COUNT = 5;
const RECS_MAX_COUNT = 100;
const RECS_MIN_RELEASED_PERCENT = 25;
const SERVICE_COOLDOWN_MS = 10 * 60 * 1000;

type RecCandidate = {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  popularity: number | null;
  sources: string[];
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampInt(
  v: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n =
    typeof v === 'number' && Number.isFinite(v)
      ? Math.trunc(v)
      : typeof v === 'string' && v.trim()
        ? Number.parseInt(v.trim(), 10)
        : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanTitles(titles: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of titles) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

@Injectable()
export class RecommendationsService {
  private googleDownUntilMs: number | null = null;
  private openAiDownUntilMs: number | null = null;

  constructor(
    private readonly tmdb: TmdbService,
    private readonly google: GoogleService,
    private readonly openai: OpenAiService,
  ) {}

  async buildSimilarMovieTitles(params: {
    ctx: JobContext;
    seedTitle: string;
    seedYear?: number | null;
    tmdbApiKey: string;
    count: number;
    webContextFraction: number;
    upcomingPercent?: number | null;
    openai?: { apiKey: string; model?: string | null } | null;
    google?: { apiKey: string; searchEngineId: string } | null;
  }): Promise<{
    titles: string[];
    strategy: 'openai' | 'tmdb';
    debug: JsonObject;
  }> {
    const { ctx } = params;
    const seedTitle = params.seedTitle.trim();
    const count = clampInt(params.count || 50, RECS_MIN_COUNT, RECS_MAX_COUNT, 50);
    const webFrac = clamp01(params.webContextFraction);

    // Progress (UI): recommendation pipeline
    void ctx
      .patchSummary({
        progress: {
          step: 'recs_tmdb_pools',
          message: 'Building recommendation pools (TMDB)…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const seedMeta = await this.tmdb.getSeedMetadata({
      apiKey: params.tmdbApiKey,
      seedTitle,
      seedYear: params.seedYear ?? null,
    });

    const openAiEnabled = Boolean(params.openai?.apiKey?.trim());
    const googleEnabled =
      Boolean(params.google?.apiKey?.trim()) &&
      Boolean(params.google?.searchEngineId?.trim());

    const upcomingPercent = clampInt(
      params.upcomingPercent ?? 25,
      0,
      100 - RECS_MIN_RELEASED_PERCENT,
      25,
    );
    const upcomingTargetRaw = Math.round((count * upcomingPercent) / 100);
    const minReleasedTarget = Math.ceil((count * RECS_MIN_RELEASED_PERCENT) / 100);
    const maxUpcomingTarget = Math.max(0, count - minReleasedTarget);
    const upcomingTarget = Math.max(0, Math.min(upcomingTargetRaw, maxUpcomingTarget));
    const releasedTarget = Math.max(0, count - upcomingTarget);

    await ctx.info('recs: split config', {
      count,
      upcomingPercent,
      upcomingTarget,
      releasedTarget,
      webContextFraction: webFrac,
    });

    // --- Tier 0 (always works): TMDB pools ---
    await ctx.info('recs: tmdb pools start', {
      seedTitle,
      seedYear: params.seedYear ?? null,
      count,
    });

    const pools = await this.tmdb.getSplitRecommendationCandidatePools({
      apiKey: params.tmdbApiKey,
      seedTitle,
      seedYear: params.seedYear ?? null,
      includeAdult: false,
      timezone: null,
      upcomingWindowMonths: 24,
    });

    let releasedPool = pools.released.slice();
    let upcomingPool = pools.upcoming.slice();
    let unknownPool = pools.unknown.slice();

    await ctx.info('recs: tmdb pools done', {
      seed: pools.seed,
      meta: pools.meta,
      releasedCandidates: releasedPool.length,
      upcomingCandidates: upcomingPool.length,
      unknownCandidates: unknownPool.length,
    });

    let fallbackUsed: 'none' | 'tmdb_discover' | 'openai_freeform' = 'none';
    let fallbackCandidatesCount = 0;
    let fallbackTitles: string[] = [];

    // --- Tier 0b: ultimate fallback when TMDB pools are empty ---
    if (!releasedPool.length && !upcomingPool.length && !unknownPool.length) {
      const fallback = await this.tmdb
        .discoverFallbackMovieCandidates({
          apiKey: params.tmdbApiKey,
          limit: Math.max(50, Math.min(400, count * 12)),
          seedYear: params.seedYear ?? null,
          genreIds: pools.seed.genreIds,
          includeAdult: false,
          timezone: null,
        })
        .catch(() => []);
      if (fallback.length) {
        releasedPool = mergeCandidatePools(releasedPool, fallback, 'tmdb_discover');
        fallbackUsed = 'tmdb_discover';
        fallbackCandidatesCount = fallback.length;
        fallbackTitles = fallback.slice(0, 30).map((c) => c.title);
        await ctx.info('recs: tmdb discover fallback used', {
          added: fallback.length,
        });
      }
    }

    let googleContext: string | null = null;
    let googleQuery: string | null = null;
    let googleMeta: JsonObject | null = null;
    let googleTitlesExtracted = 0;
    let googleTmdbAdded = 0;
    let googleSuggestedTitles: string[] = [];
    let openAiSuggestedTitles: string[] = [];
    let openAiMode: 'split' | 'no_split' | null = null;
    let openAiSkipReason:
      | 'disabled'
      | 'cooldown'
      | 'no_candidates'
      | 'error'
      | null = null;

    // --- Tier 1 (optional): Google discovery booster (never depends on OpenAI) ---
    void ctx
      .patchSummary({
        progress: {
          step: 'recs_google',
          message:
            googleEnabled && this.canUseGoogle()
              ? 'Searching the web (Google)…'
              : 'Web search (Google) skipped.',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);
    if (googleEnabled && this.canUseGoogle() && params.google) {
      const desiredGoogleResults = Math.min(
        50,
        Math.max(0, Math.ceil(count * webFrac)),
      );
      if (desiredGoogleResults > 0) {
        googleQuery = buildGoogleQuery(seedMeta, new Date().getFullYear());
        await ctx.info('recs: google search', {
          query: googleQuery,
          requested: desiredGoogleResults,
        });

        try {
          const { results, meta } = await this.google.search({
            apiKey: params.google.apiKey,
            cseId: params.google.searchEngineId,
            query: googleQuery,
            numResults: desiredGoogleResults,
          });
          googleContext = results.length
            ? this.google.formatForPrompt(results)
            : null;
          googleMeta = { ...meta };
          await ctx.info('recs: google done', { ...meta });

          const extracted = extractMovieTitleCandidatesFromGoogle(results, 60);
          googleTitlesExtracted = extracted.length;
          googleSuggestedTitles = extracted.map((t) =>
            t.year ? `${t.title} (${t.year})` : t.title,
          );
          if (extracted.length) {
            const { added, released, upcoming, unknown } =
              await this.resolveGoogleTitlesToTmdbCandidates({
                tmdbApiKey: params.tmdbApiKey,
                titles: extracted,
                today: pools.meta.today,
              });

            googleTmdbAdded = added;
            releasedPool = mergeCandidatePools(
              releasedPool,
              released,
              'google',
            );
            upcomingPool = mergeCandidatePools(
              upcomingPool,
              upcoming,
              'google',
            );
            unknownPool = mergeCandidatePools(unknownPool, unknown, 'google');
          }

          // Google was up; clear any prior cooldown.
          this.googleDownUntilMs = null;
        } catch (err) {
          await ctx.warn(
            'recs: google failed (continuing without web context)',
            {
            error: (err as Error)?.message ?? String(err),
            },
          );
          googleContext = null;
          googleSuggestedTitles = [];
          googleMeta = { failed: true };
          this.googleDownUntilMs = Date.now() + SERVICE_COOLDOWN_MS;
        }
      } else {
        googleMeta = { skipped: true, reason: 'webContextFraction=0' };
      }
    }

    // --- Phase A: deterministic pre-score + split selection (always available) ---
    const scoredReleased = scoreAndSortCandidates(releasedPool, {
      kind: 'released',
    });
    const scoredUpcoming = scoreAndSortCandidates(upcomingPool, {
      kind: 'upcoming',
    });
    const scoredUnknown = scoreAndSortCandidates(unknownPool, {
      kind: 'released',
    });

    const deterministic = selectWithSplit({
      count,
      upcomingTarget,
      releasedPool: scoredReleased,
      upcomingPool: scoredUpcoming,
      unknownPool: scoredUnknown,
    });
    const tmdbSuggestedTitles = deterministic.titles.slice();

    // --- Tier 2 (optional): OpenAI final selector from downselected candidates ---
    void ctx
      .patchSummary({
        progress: {
          step: 'recs_openai',
          message:
            openAiEnabled && this.canUseOpenAi()
              ? 'Curating recommendations (AI)…'
              : 'AI curation skipped.',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    if (!openAiEnabled) openAiSkipReason = 'disabled';
    else if (!this.canUseOpenAi()) openAiSkipReason = 'cooldown';

    if (openAiEnabled && this.canUseOpenAi() && params.openai) {
      const model =
        (params.openai?.model ?? 'gpt-5.2-chat-latest') ||
        'gpt-5.2-chat-latest';
      const topReleased = scoredReleased.slice(
        0,
        Math.min(250, Math.max(releasedTarget * 5, releasedTarget)),
      );
      const topUpcoming = scoredUpcoming.slice(
        0,
        Math.min(250, Math.max(upcomingTarget * 5, upcomingTarget)),
      );
      const topUnknown = scoredUnknown.slice(0, Math.min(250, Math.max(count * 4, count)));

      const canSatisfySplit =
        upcomingTarget === 0 || topUpcoming.length >= upcomingTarget;

      const anyCandidates =
        topReleased.length || topUpcoming.length || topUnknown.length;
      if (!anyCandidates) {
        openAiSkipReason = 'no_candidates';
      } else {
        try {
          if (canSatisfySplit) {
            openAiMode = 'split';
        await ctx.info('recs: openai select start', {
          model,
        count,
          releasedTarget,
          upcomingTarget,
          candidates: {
            released: topReleased.length,
            upcoming: topUpcoming.length,
          },
        googleUsed: Boolean(googleContext),
          googleTitlesExtracted,
          googleTmdbAdded,
              mode: 'split',
      });

          const selection = await this.openai.selectFromCandidates({
          apiKey: params.openai.apiKey,
            model,
          seedTitle,
          tmdbSeedMetadata: seedMeta,
            releasedTarget,
            upcomingTarget,
            releasedCandidates: topReleased,
            upcomingCandidates: topUpcoming,
          });

          if (
            selection.released.length === releasedTarget &&
            selection.upcoming.length === upcomingTarget
          ) {
            const releasedById = new Map(topReleased.map((c) => [c.tmdbId, c]));
            const upcomingById = new Map(topUpcoming.map((c) => [c.tmdbId, c]));

            const titles: string[] = [];
            for (const id of selection.released) {
              const t = releasedById.get(id)?.title ?? '';
              if (t.trim()) titles.push(t.trim());
            }
            for (const id of selection.upcoming) {
              const t = upcomingById.get(id)?.title ?? '';
              if (t.trim()) titles.push(t.trim());
            }

              const cleaned = cleanTitles(titles, count);
            openAiSuggestedTitles = cleaned.slice();
            await ctx.info('recs: openai select done', {
              returned: cleaned.length,
              released: releasedTarget,
              upcoming: upcomingTarget,
                mode: 'split',
            });
            this.openAiDownUntilMs = null;
          return {
            titles: cleaned,
            strategy: 'openai',
            debug: {
                upcomingPercent,
                upcomingTarget,
                releasedTarget,
              googleEnabled,
              googleQuery,
              googleMeta: googleMeta ?? null,
                googleTitlesExtracted,
                googleTmdbAdded,
                googleSuggestedTitles,
              openAiEnabled: true,
                openAiModel: model,
                  openAiMode,
                  openAiSkipReason,
                  fallbackUsed,
                  fallbackCandidatesCount,
                  fallbackTitles,
                openAiSuggestedTitles,
                tmdbSuggestedTitles,
                used: {
                  tmdb: true,
                  google: Boolean(googleContext),
                  openai: true,
                },
            },
          };
        }

          await ctx.warn(
            'recs: openai selector returned empty (falling back to deterministic)',
          );
          } else {
            openAiMode = 'no_split';
            const candidates = uniqueByTmdbId([
              ...topReleased,
              ...topUpcoming,
              ...topUnknown,
            ]).slice(0, 350);

            await ctx.info('recs: openai select start', {
              model,
              count,
              candidates: candidates.length,
              mode: 'no_split',
            });

            const ids = await this.openai.selectFromCandidatesNoSplit({
              apiKey: params.openai.apiKey,
              model,
              seedTitle,
              tmdbSeedMetadata: seedMeta,
              count,
              candidates,
            });
            if (ids.length === count) {
              const byId = new Map(candidates.map((c) => [c.tmdbId, c.title]));
              const ordered = ids.map((id) => byId.get(id) ?? String(id));
              const cleaned = cleanTitles(ordered, count);
              openAiSuggestedTitles = cleaned.slice();
              await ctx.info('recs: openai select done', {
                returned: cleaned.length,
                mode: 'no_split',
              });
              this.openAiDownUntilMs = null;
              return {
                titles: cleaned,
                strategy: 'openai',
                debug: {
                  upcomingPercent,
                  upcomingTarget,
                  releasedTarget,
                  googleEnabled,
                  googleQuery,
                  googleMeta: googleMeta ?? null,
                  googleTitlesExtracted,
                  googleTmdbAdded,
                  googleSuggestedTitles,
                  openAiEnabled: true,
                  openAiModel: model,
                  openAiMode,
                  openAiSkipReason,
                  fallbackUsed,
                  fallbackCandidatesCount,
                  fallbackTitles,
                  openAiSuggestedTitles,
                  tmdbSuggestedTitles,
                  used: {
                    tmdb: true,
                    google: Boolean(googleContext),
                    openai: true,
                  },
                },
              };
            }
          }
      } catch (err) {
          openAiSkipReason = 'error';
          await ctx.warn(
            'recs: openai selector failed (falling back to deterministic)',
            {
          error: (err as Error)?.message ?? String(err),
              mode: openAiMode ?? null,
            },
          );
          this.openAiDownUntilMs = Date.now() + SERVICE_COOLDOWN_MS;
        }
      }
    }

    // --- Tier 3 (ultimate): OpenAI freeform fallback when we have no candidates at all ---
    if (!deterministic.titles.length) {
      const canUseFreeform =
        openAiEnabled && this.canUseOpenAi() && Boolean(params.openai?.apiKey?.trim());
      if (!canUseFreeform) {
        // keep deterministic (empty)
      } else {
        try {
          const model =
            (params.openai?.model ?? 'gpt-5.2-chat-latest') || 'gpt-5.2-chat-latest';
          const titles = await this.openai.getRelatedMovieTitles({
            apiKey: params.openai.apiKey,
            model,
            seedTitle,
            limit: count,
            tmdbSeedMetadata: seedMeta,
            googleSearchContext: googleContext,
            upcomingCapFraction: 0.0,
          });

          const parsed = parseTitleYearCandidates(titles);
          const resolved = await this.resolveGoogleTitlesToTmdbCandidates({
            tmdbApiKey: params.tmdbApiKey,
            titles: parsed,
            today: pools.meta.today,
          });

          const fallbackPool = mergeCandidatePools([], resolved.released, 'openai_freeform');
          const scored = scoreAndSortCandidates(fallbackPool, { kind: 'released' });
          const picked = scored.slice(0, count).map((c) => c.title);
          const cleaned = cleanTitles(picked.length ? picked : titles, count);

          fallbackUsed = 'openai_freeform';
          fallbackCandidatesCount = resolved.added;
          fallbackTitles = cleaned.slice(0, 30);
          openAiSuggestedTitles = cleaned.slice();
          this.openAiDownUntilMs = null;

          await ctx.info('recs: openai freeform fallback used', {
            returned: cleaned.length,
            tmdbValidated: resolved.added,
          });

          return {
            titles: cleaned,
            strategy: 'openai',
            debug: {
              upcomingPercent,
              upcomingTarget,
              releasedTarget,
              googleEnabled,
              googleQuery,
              googleMeta: googleMeta ?? null,
              googleTitlesExtracted,
              googleTmdbAdded,
              googleSuggestedTitles,
              openAiEnabled: true,
              openAiModel: model,
              openAiMode: null,
              openAiSkipReason: null,
              fallbackUsed,
              fallbackCandidatesCount,
              fallbackTitles,
              openAiSuggestedTitles,
              tmdbSuggestedTitles,
              used: {
                tmdb: false,
                google: Boolean(googleContext),
                openai: true,
              },
            },
          };
        } catch (err) {
          openAiSkipReason = 'error';
          await ctx.warn('recs: openai freeform fallback failed', {
            error: (err as Error)?.message ?? String(err),
          });
          this.openAiDownUntilMs = Date.now() + SERVICE_COOLDOWN_MS;
        }
      }
    }

    await ctx.info('recs: deterministic select done', {
      returned: deterministic.titles.length,
      released: deterministic.releasedCount,
      upcoming: deterministic.upcomingCount,
      googleTitlesExtracted,
      googleTmdbAdded,
    });

    return {
      titles: deterministic.titles,
      strategy: 'tmdb',
      debug: {
        upcomingPercent,
        upcomingTarget,
        releasedTarget,
        googleEnabled,
        googleQuery,
        googleMeta: googleMeta ?? null,
        googleTitlesExtracted,
        googleTmdbAdded,
        openAiEnabled,
        openAiMode,
        openAiSkipReason,
        fallbackUsed,
        fallbackCandidatesCount,
        fallbackTitles,
        googleSuggestedTitles,
        openAiSuggestedTitles,
        tmdbSuggestedTitles,
        used: { tmdb: true, google: Boolean(googleContext), openai: false },
      },
    };
  }

  async buildSimilarTvTitles(params: {
    ctx: JobContext;
    seedTitle: string;
    seedYear?: number | null;
    tmdbApiKey: string;
    count: number;
    webContextFraction: number;
    upcomingPercent?: number | null;
    openai?: { apiKey: string; model?: string | null } | null;
    google?: { apiKey: string; searchEngineId: string } | null;
  }): Promise<{
    titles: string[];
    strategy: 'openai' | 'tmdb';
    debug: JsonObject;
  }> {
    const { ctx } = params;
    const seedTitle = params.seedTitle.trim();
    const count = clampInt(
      params.count || 50,
      RECS_MIN_COUNT,
      RECS_MAX_COUNT,
      50,
    );
    const webFrac = clamp01(params.webContextFraction);

    // Progress (UI): recommendation pipeline
    void ctx
      .patchSummary({
        progress: {
          step: 'recs_tmdb_pools',
          message: 'Building recommendation pools (TMDB)…',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    const seedMeta = await this.tmdb.getTvSeedMetadata({
      apiKey: params.tmdbApiKey,
      seedTitle,
      seedYear: params.seedYear ?? null,
    });

    const openAiEnabled = Boolean(params.openai?.apiKey?.trim());
    const googleEnabled =
      Boolean(params.google?.apiKey?.trim()) &&
      Boolean(params.google?.searchEngineId?.trim());

    const upcomingPercent = clampInt(
      params.upcomingPercent ?? 25,
      0,
      100 - RECS_MIN_RELEASED_PERCENT,
      25,
    );
    const upcomingTargetRaw = Math.round((count * upcomingPercent) / 100);
    const minReleasedTarget = Math.ceil(
      (count * RECS_MIN_RELEASED_PERCENT) / 100,
    );
    const maxUpcomingTarget = Math.max(0, count - minReleasedTarget);
    const upcomingTarget = Math.max(
      0,
      Math.min(upcomingTargetRaw, maxUpcomingTarget),
    );
    const releasedTarget = Math.max(0, count - upcomingTarget);

    await ctx.info('recs(tv): split config', {
      count,
      upcomingPercent,
      upcomingTarget,
      releasedTarget,
      webContextFraction: webFrac,
    });

    // --- Tier 0 (always works): TMDB pools ---
    await ctx.info('recs(tv): tmdb pools start', {
      seedTitle,
      seedYear: params.seedYear ?? null,
      count,
    });

    const pools = await this.tmdb.getSplitTvRecommendationCandidatePools({
      apiKey: params.tmdbApiKey,
      seedTitle,
      seedYear: params.seedYear ?? null,
      includeAdult: false,
      timezone: null,
      upcomingWindowMonths: 24,
    });

    let releasedPool = pools.released.slice();
    let upcomingPool = pools.upcoming.slice();
    let unknownPool = pools.unknown.slice();

    await ctx.info('recs(tv): tmdb pools done', {
      seed: pools.seed,
      meta: pools.meta,
      releasedCandidates: releasedPool.length,
      upcomingCandidates: upcomingPool.length,
      unknownCandidates: unknownPool.length,
    });

    let fallbackUsed: 'none' | 'tmdb_discover' | 'openai_freeform' = 'none';
    let fallbackCandidatesCount = 0;
    let fallbackTitles: string[] = [];

    // --- Tier 0b: ultimate fallback when TMDB pools are empty ---
    if (!releasedPool.length && !upcomingPool.length && !unknownPool.length) {
      const fallback = await this.tmdb
        .discoverFallbackTvCandidates({
          apiKey: params.tmdbApiKey,
          limit: Math.max(50, Math.min(400, count * 12)),
          seedYear: params.seedYear ?? null,
          genreIds: pools.seed.genreIds,
          includeAdult: false,
          timezone: null,
        })
        .catch(() => []);
      if (fallback.length) {
        releasedPool = mergeCandidatePools(releasedPool, fallback, 'tmdb_discover');
        fallbackUsed = 'tmdb_discover';
        fallbackCandidatesCount = fallback.length;
        fallbackTitles = fallback.slice(0, 30).map((c) => c.title);
        await ctx.info('recs(tv): tmdb discover fallback used', {
          added: fallback.length,
        });
      }
    }

    let googleContext: string | null = null;
    let googleQuery: string | null = null;
    let googleMeta: JsonObject | null = null;
    let googleTitlesExtracted = 0;
    let googleTmdbAdded = 0;
    let googleSuggestedTitles: string[] = [];
    let openAiSuggestedTitles: string[] = [];
    let openAiMode: 'split' | 'no_split' | null = null;
    let openAiSkipReason:
      | 'disabled'
      | 'cooldown'
      | 'no_candidates'
      | 'error'
      | null = null;

    // --- Tier 1 (optional): Google discovery booster (never depends on OpenAI) ---
    void ctx
      .patchSummary({
        progress: {
          step: 'recs_google',
          message:
            googleEnabled && this.canUseGoogle()
              ? 'Searching the web (Google)…'
              : 'Web search (Google) skipped.',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);
    if (googleEnabled && this.canUseGoogle() && params.google) {
      const desiredGoogleResults = Math.min(
        50,
        Math.max(0, Math.ceil(count * webFrac)),
      );
      if (desiredGoogleResults > 0) {
        googleQuery = buildGoogleQueryTv(seedMeta, new Date().getFullYear());
        await ctx.info('recs(tv): google search', {
          query: googleQuery,
          requested: desiredGoogleResults,
        });

        try {
          const { results, meta } = await this.google.search({
            apiKey: params.google.apiKey,
            cseId: params.google.searchEngineId,
            query: googleQuery,
            numResults: desiredGoogleResults,
          });
          googleContext = results.length
            ? this.google.formatForPrompt(results)
            : null;
          googleMeta = { ...meta };
          await ctx.info('recs(tv): google done', { ...meta });

          const extracted = extractMovieTitleCandidatesFromGoogle(results, 60);
          googleTitlesExtracted = extracted.length;
          googleSuggestedTitles = extracted.map((t) =>
            t.year ? `${t.title} (${t.year})` : t.title,
          );
          if (extracted.length) {
            const { added, released, upcoming, unknown } =
              await this.resolveGoogleTitlesToTmdbTvCandidates({
                tmdbApiKey: params.tmdbApiKey,
                titles: extracted,
                today: pools.meta.today,
              });

            googleTmdbAdded = added;
            releasedPool = mergeCandidatePools(releasedPool, released, 'google');
            upcomingPool = mergeCandidatePools(upcomingPool, upcoming, 'google');
            unknownPool = mergeCandidatePools(unknownPool, unknown, 'google');
          }

          this.googleDownUntilMs = null;
        } catch (err) {
          await ctx.warn(
            'recs(tv): google failed (continuing without web context)',
            {
              error: (err as Error)?.message ?? String(err),
            },
          );
          googleContext = null;
          googleSuggestedTitles = [];
          googleMeta = { failed: true };
          this.googleDownUntilMs = Date.now() + SERVICE_COOLDOWN_MS;
        }
      } else {
        googleMeta = { skipped: true, reason: 'webContextFraction=0' };
      }
    }

    // --- Phase A: deterministic pre-score + split selection (always available) ---
    const scoredReleased = scoreAndSortCandidates(releasedPool, {
      kind: 'released',
    });
    const scoredUpcoming = scoreAndSortCandidates(upcomingPool, {
      kind: 'upcoming',
    });
    const scoredUnknown = scoreAndSortCandidates(unknownPool, {
      kind: 'released',
    });

    const deterministic = selectWithSplit({
      count,
      upcomingTarget,
      releasedPool: scoredReleased,
      upcomingPool: scoredUpcoming,
      unknownPool: scoredUnknown,
    });
    const tmdbSuggestedTitles = deterministic.titles.slice();

    // --- Tier 2 (optional): OpenAI final selector from downselected candidates ---
    void ctx
      .patchSummary({
        progress: {
          step: 'recs_openai',
          message:
            openAiEnabled && this.canUseOpenAi()
              ? 'Curating recommendations (AI)…'
              : 'AI curation skipped.',
          updatedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);

    if (!openAiEnabled) openAiSkipReason = 'disabled';
    else if (!this.canUseOpenAi()) openAiSkipReason = 'cooldown';

    if (openAiEnabled && this.canUseOpenAi() && params.openai) {
      const model =
        (params.openai?.model ?? 'gpt-5.2-chat-latest') || 'gpt-5.2-chat-latest';
      const topReleased = scoredReleased.slice(
        0,
        Math.min(250, Math.max(releasedTarget * 5, releasedTarget)),
      );
      const topUpcoming = scoredUpcoming.slice(
        0,
        Math.min(250, Math.max(upcomingTarget * 5, upcomingTarget)),
      );
      const topUnknown = scoredUnknown.slice(0, Math.min(250, Math.max(count * 4, count)));

      const canSatisfySplit =
        upcomingTarget === 0 || topUpcoming.length >= upcomingTarget;

      const anyCandidates =
        topReleased.length || topUpcoming.length || topUnknown.length;
      if (!anyCandidates) {
        openAiSkipReason = 'no_candidates';
      } else {
        try {
          if (canSatisfySplit) {
            openAiMode = 'split';
        await ctx.info('recs(tv): openai select start', {
          model,
          releasedCandidates: topReleased.length,
          upcomingCandidates: topUpcoming.length,
          releasedTarget,
          upcomingTarget,
              mode: 'split',
        });

          const selected = await this.openai.selectFromCandidates({
            apiKey: params.openai.apiKey,
            model,
            seedTitle,
            mediaType: 'tv',
            tmdbSeedMetadata: seedMeta,
            releasedTarget,
            upcomingTarget,
            releasedCandidates: topReleased,
            upcomingCandidates: topUpcoming,
          });

          if (
            selected.released.length === releasedTarget &&
            selected.upcoming.length === upcomingTarget
          ) {
            const idToTitle = new Map<number, string>();
            for (const c of [...topReleased, ...topUpcoming]) {
              if (!idToTitle.has(c.tmdbId)) idToTitle.set(c.tmdbId, c.title);
            }
            const ordered = [
              ...selected.released,
              ...selected.upcoming,
            ].map((id) => idToTitle.get(id) ?? String(id));
            const cleaned = cleanTitles(ordered, count);
            openAiSuggestedTitles = cleaned.slice();

            await ctx.info('recs(tv): openai select done', {
              returned: cleaned.length,
              released: selected.released.length,
              upcoming: selected.upcoming.length,
                mode: 'split',
            });

            this.openAiDownUntilMs = null;
            return {
              titles: cleaned,
              strategy: 'openai',
              debug: {
                upcomingPercent,
                upcomingTarget,
                releasedTarget,
                googleEnabled,
                googleQuery,
                googleMeta: googleMeta ?? null,
                googleTitlesExtracted,
                googleTmdbAdded,
                  openAiEnabled: true,
                  openAiModel: model,
                  openAiMode,
                  openAiSkipReason,
                  fallbackUsed,
                  fallbackCandidatesCount,
                  fallbackTitles,
                googleSuggestedTitles,
                openAiSuggestedTitles,
                tmdbSuggestedTitles,
                used: {
                  tmdb: true,
                  google: Boolean(googleContext),
                  openai: true,
                },
              },
            };
          }

          await ctx.warn('recs(tv): openai invalid selection (fallback)', {
            releasedReturned: selected.released.length,
            upcomingReturned: selected.upcoming.length,
            releasedTarget,
            upcomingTarget,
          });
          } else {
            openAiMode = 'no_split';
            const candidates = uniqueByTmdbId([
              ...topReleased,
              ...topUpcoming,
              ...topUnknown,
            ]).slice(0, 350);

            await ctx.info('recs(tv): openai select start', {
              model,
              candidates: candidates.length,
              count,
              mode: 'no_split',
            });

            const ids = await this.openai.selectFromCandidatesNoSplit({
              apiKey: params.openai.apiKey,
              model,
              seedTitle,
              mediaType: 'tv',
              tmdbSeedMetadata: seedMeta,
              count,
              candidates,
            });
            if (ids.length === count) {
              const byId = new Map(candidates.map((c) => [c.tmdbId, c.title]));
              const ordered = ids.map((id) => byId.get(id) ?? String(id));
              const cleaned = cleanTitles(ordered, count);
              openAiSuggestedTitles = cleaned.slice();

              await ctx.info('recs(tv): openai select done', {
                returned: cleaned.length,
                mode: 'no_split',
              });

              this.openAiDownUntilMs = null;
              return {
                titles: cleaned,
                strategy: 'openai',
                debug: {
                  upcomingPercent,
                  upcomingTarget,
                  releasedTarget,
                  googleEnabled,
                  googleQuery,
                  googleMeta: googleMeta ?? null,
                  googleTitlesExtracted,
                  googleTmdbAdded,
                  openAiEnabled: true,
                  openAiModel: model,
                  openAiMode,
                  openAiSkipReason,
                  fallbackUsed,
                  fallbackCandidatesCount,
                  fallbackTitles,
                  googleSuggestedTitles,
                  openAiSuggestedTitles,
                  tmdbSuggestedTitles,
                  used: {
                    tmdb: true,
                    google: Boolean(googleContext),
                    openai: true,
                  },
                },
              };
            }
          }
        } catch (err) {
          openAiSkipReason = 'error';
          await ctx.warn(
            'recs(tv): openai selector failed (falling back to deterministic)',
            {
              error: (err as Error)?.message ?? String(err),
              mode: openAiMode ?? null,
            },
          );
          this.openAiDownUntilMs = Date.now() + SERVICE_COOLDOWN_MS;
        }
      }
    }

    // --- Tier 3 (ultimate): OpenAI freeform fallback when we have no candidates at all ---
    if (!deterministic.titles.length) {
      const canUseFreeform =
        openAiEnabled && this.canUseOpenAi() && Boolean(params.openai?.apiKey?.trim());
      if (!canUseFreeform) {
        // keep deterministic (empty)
      } else {
        try {
          const model =
            (params.openai?.model ?? 'gpt-5.2-chat-latest') || 'gpt-5.2-chat-latest';
          const titles = await this.openai.getRelatedTvTitles({
            apiKey: params.openai.apiKey,
            model,
            seedTitle,
            limit: count,
            tmdbSeedMetadata: seedMeta,
            googleSearchContext: googleContext,
          });

          const parsed = parseTitleYearCandidates(titles);
          const resolved = await this.resolveGoogleTitlesToTmdbTvCandidates({
            tmdbApiKey: params.tmdbApiKey,
            titles: parsed,
            today: pools.meta.today,
          });

          const fallbackPool = mergeCandidatePools([], resolved.released, 'openai_freeform');
          const scored = scoreAndSortCandidates(fallbackPool, { kind: 'released' });
          const picked = scored.slice(0, count).map((c) => c.title);
          const cleaned = cleanTitles(picked.length ? picked : titles, count);

          fallbackUsed = 'openai_freeform';
          fallbackCandidatesCount = resolved.added;
          fallbackTitles = cleaned.slice(0, 30);
          openAiSuggestedTitles = cleaned.slice();
          this.openAiDownUntilMs = null;

          await ctx.info('recs(tv): openai freeform fallback used', {
            returned: cleaned.length,
            tmdbValidated: resolved.added,
          });

          return {
            titles: cleaned,
            strategy: 'openai',
            debug: {
              upcomingPercent,
              upcomingTarget,
              releasedTarget,
              googleEnabled,
              googleQuery,
              googleMeta: googleMeta ?? null,
              googleTitlesExtracted,
              googleTmdbAdded,
              openAiEnabled: true,
              openAiModel: model,
              openAiMode: null,
              openAiSkipReason: null,
              fallbackUsed,
              fallbackCandidatesCount,
              fallbackTitles,
              googleSuggestedTitles,
              openAiSuggestedTitles,
              tmdbSuggestedTitles,
              used: {
                tmdb: false,
                google: Boolean(googleContext),
                openai: true,
              },
            },
          };
        } catch (err) {
          openAiSkipReason = 'error';
          await ctx.warn('recs(tv): openai freeform fallback failed', {
            error: (err as Error)?.message ?? String(err),
          });
          this.openAiDownUntilMs = Date.now() + SERVICE_COOLDOWN_MS;
        }
      }
    }

    await ctx.info('recs(tv): deterministic select done', {
      returned: deterministic.titles.length,
      released: deterministic.releasedCount,
      upcoming: deterministic.upcomingCount,
      googleTitlesExtracted,
      googleTmdbAdded,
    });

    return {
      titles: deterministic.titles,
      strategy: 'tmdb',
      debug: {
        upcomingPercent,
        upcomingTarget,
        releasedTarget,
        googleEnabled,
        googleQuery,
        googleMeta: googleMeta ?? null,
        googleTitlesExtracted,
        googleTmdbAdded,
        openAiEnabled,
        openAiMode,
        openAiSkipReason,
        fallbackUsed,
        fallbackCandidatesCount,
        fallbackTitles,
        googleSuggestedTitles,
        openAiSuggestedTitles,
        tmdbSuggestedTitles,
        used: { tmdb: true, google: Boolean(googleContext), openai: false },
      },
    };
  }

  async buildChangeOfTasteMovieTitles(params: {
    ctx: JobContext;
    seedTitle: string;
    seedYear?: number | null;
    tmdbApiKey: string;
    count: number;
    upcomingPercent?: number | null;
    openai?: { apiKey: string; model?: string | null } | null;
  }): Promise<{ titles: string[]; strategy: 'openai' | 'tmdb' }> {
    const { ctx } = params;
    const seedTitle = params.seedTitle.trim();
    const count = clampInt(params.count || 50, RECS_MIN_COUNT, RECS_MAX_COUNT, 50);

    const openAiEnabled = Boolean(params.openai?.apiKey?.trim());

    const upcomingPercent = clampInt(
      params.upcomingPercent ?? 25,
      0,
      100 - RECS_MIN_RELEASED_PERCENT,
      25,
    );
    const upcomingTargetRaw = Math.round((count * upcomingPercent) / 100);
    const minReleasedTarget = Math.ceil((count * RECS_MIN_RELEASED_PERCENT) / 100);
    const maxUpcomingTarget = Math.max(0, count - minReleasedTarget);
    const upcomingTarget = Math.max(0, Math.min(upcomingTargetRaw, maxUpcomingTarget));
    const releasedTarget = Math.max(0, count - upcomingTarget);

    await ctx.info('change_of_taste: split config', {
      count,
      upcomingPercent,
      upcomingTarget,
      releasedTarget,
    });

    await ctx.info('change_of_taste: tmdb pools start', {
      seedTitle,
      seedYear: params.seedYear ?? null,
      count,
    });
    const pools = await this.tmdb.getSplitContrastRecommendationCandidatePools({
      apiKey: params.tmdbApiKey,
      seedTitle,
      seedYear: params.seedYear ?? null,
      includeAdult: false,
      timezone: null,
      upcomingWindowMonths: 24,
    });

    let releasedPool = pools.released.slice();
    let upcomingPool = pools.upcoming.slice();
    let unknownPool = pools.unknown.slice();

    await ctx.info('change_of_taste: tmdb pools done', {
      seed: pools.seed,
      meta: pools.meta,
      releasedCandidates: releasedPool.length,
      upcomingCandidates: upcomingPool.length,
      unknownCandidates: unknownPool.length,
    });

    // --- Phase A: deterministic pre-score + split selection (always available) ---
    const scoredReleased = scoreAndSortCandidates(releasedPool, {
      kind: 'released',
    });
    const scoredUpcoming = scoreAndSortCandidates(upcomingPool, {
      kind: 'upcoming',
    });
    const scoredUnknown = scoreAndSortCandidates(unknownPool, {
      kind: 'released',
    });

    const deterministic = selectWithSplit({
      count,
      upcomingTarget,
      releasedPool: scoredReleased,
      upcomingPool: scoredUpcoming,
      unknownPool: scoredUnknown,
    });

    // --- Tier 2 (optional): OpenAI final selector from downselected candidates ---
    if (openAiEnabled && this.canUseOpenAi() && params.openai) {
      const model =
        (params.openai?.model ?? 'gpt-5.2-chat-latest') ||
        'gpt-5.2-chat-latest';
      const topReleased = scoredReleased.slice(
        0,
        Math.min(250, Math.max(releasedTarget * 5, releasedTarget)),
      );
      const topUpcoming = scoredUpcoming.slice(
        0,
        Math.min(250, Math.max(upcomingTarget * 5, upcomingTarget)),
      );

      const canSatisfySplit =
        upcomingTarget === 0 || topUpcoming.length >= upcomingTarget;

      if (canSatisfySplit && (topReleased.length || topUpcoming.length)) {
        await ctx.info('change_of_taste: openai select start', {
          model,
          count,
          releasedTarget,
          upcomingTarget,
          candidates: {
            released: topReleased.length,
            upcoming: topUpcoming.length,
          },
        });

        try {
          const selection = await this.openai.selectFromCandidates({
            apiKey: params.openai.apiKey,
            model,
            seedTitle,
            tmdbSeedMetadata: { intent: 'change_of_taste', seed: pools.seed },
            releasedTarget,
            upcomingTarget,
            releasedCandidates: topReleased,
            upcomingCandidates: topUpcoming,
          });

          if (
            selection.released.length === releasedTarget &&
            selection.upcoming.length === upcomingTarget
          ) {
            const releasedById = new Map(topReleased.map((c) => [c.tmdbId, c]));
            const upcomingById = new Map(topUpcoming.map((c) => [c.tmdbId, c]));

            const titles: string[] = [];
            for (const id of selection.released) {
              const t = releasedById.get(id)?.title ?? '';
              if (t.trim()) titles.push(t.trim());
            }
            for (const id of selection.upcoming) {
              const t = upcomingById.get(id)?.title ?? '';
              if (t.trim()) titles.push(t.trim());
            }

            const cleaned = titles.slice(0, releasedTarget + upcomingTarget);
            if (cleaned.length !== releasedTarget + upcomingTarget) {
              throw new Error(
                `OpenAI selection underfilled: expected ${releasedTarget + upcomingTarget}, got ${cleaned.length}`,
              );
            }
            await ctx.info('change_of_taste: openai select done', {
              returned: cleaned.length,
              released: releasedTarget,
              upcoming: upcomingTarget,
            });
            this.openAiDownUntilMs = null;
            return { titles: cleaned, strategy: 'openai' };
          }

          await ctx.warn('change_of_taste: openai invalid selection (fallback)', {
            releasedReturned: selection.released.length,
            upcomingReturned: selection.upcoming.length,
            releasedTarget,
            upcomingTarget,
          });
        } catch (err) {
          await ctx.warn(
            'change_of_taste: openai selector failed (falling back to deterministic)',
            {
              error: (err as Error)?.message ?? String(err),
            },
          );
          this.openAiDownUntilMs = Date.now() + SERVICE_COOLDOWN_MS;
        }
      }
    }

    await ctx.info('change_of_taste: deterministic select done', {
      returned: deterministic.titles.length,
      released: deterministic.releasedCount,
      upcoming: deterministic.upcomingCount,
    });

    return { titles: deterministic.titles, strategy: 'tmdb' };
  }

  async buildChangeOfTasteTvTitles(params: {
    ctx: JobContext;
    seedTitle: string;
    seedYear?: number | null;
    tmdbApiKey: string;
    count: number;
    upcomingPercent?: number | null;
    openai?: { apiKey: string; model?: string | null } | null;
  }): Promise<{ titles: string[]; strategy: 'openai' | 'tmdb' }> {
    const { ctx } = params;
    const seedTitle = params.seedTitle.trim();
    const count = clampInt(
      params.count || 50,
      RECS_MIN_COUNT,
      RECS_MAX_COUNT,
      50,
    );

    const openAiEnabled = Boolean(params.openai?.apiKey?.trim());

    const upcomingPercent = clampInt(
      params.upcomingPercent ?? 25,
      0,
      100 - RECS_MIN_RELEASED_PERCENT,
      25,
    );
    const upcomingTargetRaw = Math.round((count * upcomingPercent) / 100);
    const minReleasedTarget = Math.ceil((count * RECS_MIN_RELEASED_PERCENT) / 100);
    const maxUpcomingTarget = Math.max(0, count - minReleasedTarget);
    const upcomingTarget = Math.max(0, Math.min(upcomingTargetRaw, maxUpcomingTarget));
    const releasedTarget = Math.max(0, count - upcomingTarget);

    await ctx.info('change_of_taste(tv): split config', {
      count,
      upcomingPercent,
      upcomingTarget,
      releasedTarget,
    });

    await ctx.info('change_of_taste(tv): tmdb pools start', {
      seedTitle,
      seedYear: params.seedYear ?? null,
      count,
    });
    const pools = await this.tmdb.getSplitContrastTvRecommendationCandidatePools({
      apiKey: params.tmdbApiKey,
      seedTitle,
      seedYear: params.seedYear ?? null,
      includeAdult: false,
      timezone: null,
      upcomingWindowMonths: 24,
    });

    let releasedPool = pools.released.slice();
    let upcomingPool = pools.upcoming.slice();
    let unknownPool = pools.unknown.slice();

    await ctx.info('change_of_taste(tv): tmdb pools done', {
      seed: pools.seed,
      meta: pools.meta,
      releasedCandidates: releasedPool.length,
      upcomingCandidates: upcomingPool.length,
      unknownCandidates: unknownPool.length,
    });

    const scoredReleased = scoreAndSortCandidates(releasedPool, {
      kind: 'released',
    });
    const scoredUpcoming = scoreAndSortCandidates(upcomingPool, {
      kind: 'upcoming',
    });
    const scoredUnknown = scoreAndSortCandidates(unknownPool, {
      kind: 'released',
    });

    const deterministic = selectWithSplit({
      count,
      upcomingTarget,
      releasedPool: scoredReleased,
      upcomingPool: scoredUpcoming,
      unknownPool: scoredUnknown,
    });

    if (openAiEnabled && this.canUseOpenAi() && params.openai) {
      const model =
        (params.openai?.model ?? 'gpt-5.2-chat-latest') || 'gpt-5.2-chat-latest';
      const topReleased = scoredReleased.slice(
        0,
        Math.min(250, Math.max(releasedTarget * 5, releasedTarget)),
      );
      const topUpcoming = scoredUpcoming.slice(
        0,
        Math.min(250, Math.max(upcomingTarget * 5, upcomingTarget)),
      );

      const canSatisfySplit =
        upcomingTarget === 0 || topUpcoming.length >= upcomingTarget;

      if (canSatisfySplit && (topReleased.length || topUpcoming.length)) {
        await ctx.info('change_of_taste(tv): openai select start', {
          model,
          releasedCandidates: topReleased.length,
          upcomingCandidates: topUpcoming.length,
          releasedTarget,
          upcomingTarget,
        });

        try {
          const selected = await this.openai.selectFromCandidates({
            apiKey: params.openai.apiKey,
            model,
            seedTitle,
            mediaType: 'tv',
            tmdbSeedMetadata: { intent: 'change_of_taste', seed: pools.seed },
            releasedTarget,
            upcomingTarget,
            releasedCandidates: topReleased,
            upcomingCandidates: topUpcoming,
          });

          if (
            selected.released.length === releasedTarget &&
            selected.upcoming.length === upcomingTarget
          ) {
            const selectedIds = new Set<number>([
              ...selected.released,
              ...selected.upcoming,
            ]);
            const idToTitle = new Map<number, string>();
            for (const c of [...topReleased, ...topUpcoming]) {
              if (!idToTitle.has(c.tmdbId)) idToTitle.set(c.tmdbId, c.title);
            }
            const ordered = [
              ...selected.released,
              ...selected.upcoming,
            ]
              .filter((id) => selectedIds.has(id))
              .map((id) => idToTitle.get(id) ?? String(id));
            const cleaned = cleanTitles(ordered, count);

            await ctx.info('change_of_taste(tv): openai select done', {
              returned: cleaned.length,
              released: selected.released.length,
              upcoming: selected.upcoming.length,
            });

            this.openAiDownUntilMs = null;
            return { titles: cleaned, strategy: 'openai' };
          }

          await ctx.warn('change_of_taste(tv): openai invalid selection (fallback)', {
            releasedReturned: selected.released.length,
            upcomingReturned: selected.upcoming.length,
            releasedTarget,
            upcomingTarget,
          });
        } catch (err) {
          await ctx.warn(
            'change_of_taste(tv): openai selector failed (falling back to deterministic)',
            {
              error: (err as Error)?.message ?? String(err),
            },
          );
          this.openAiDownUntilMs = Date.now() + SERVICE_COOLDOWN_MS;
        }
      }
    }

    await ctx.info('change_of_taste(tv): deterministic select done', {
      returned: deterministic.titles.length,
      released: deterministic.releasedCount,
      upcoming: deterministic.upcomingCount,
    });

    return { titles: deterministic.titles, strategy: 'tmdb' };
  }

  private canUseGoogle() {
    return !this.googleDownUntilMs || Date.now() >= this.googleDownUntilMs;
  }

  private canUseOpenAi() {
    return !this.openAiDownUntilMs || Date.now() >= this.openAiDownUntilMs;
  }

  private async resolveGoogleTitlesToTmdbCandidates(params: {
    tmdbApiKey: string;
    titles: Array<{ title: string; year: number | null }>;
    today: string;
  }): Promise<{
    added: number;
    released: RecCandidate[];
    upcoming: RecCandidate[];
    unknown: RecCandidate[];
  }> {
    const released: RecCandidate[] = [];
    const upcoming: RecCandidate[] = [];
    const unknown: RecCandidate[] = [];
    let added = 0;

    for (const t of params.titles) {
      const title = (t?.title ?? '').trim();
      if (!title) continue;
      const year =
        typeof t.year === 'number' && Number.isFinite(t.year)
          ? Math.trunc(t.year)
          : null;

      const results = await this.tmdb
        .searchMovie({
          apiKey: params.tmdbApiKey,
          query: title,
          year,
          includeAdult: false,
        })
        .catch(() => []);

      const best = results[0] ?? null;
      if (!best) continue;

      const releaseDate =
        typeof best.release_date === 'string' && best.release_date.trim()
          ? best.release_date.trim()
          : null;
      const candidate: RecCandidate = {
        tmdbId: best.id,
        title: best.title,
        releaseDate,
        voteAverage:
          typeof best.vote_average === 'number' &&
          Number.isFinite(best.vote_average)
            ? Number(best.vote_average)
            : null,
        voteCount:
          typeof best.vote_count === 'number' &&
          Number.isFinite(best.vote_count)
            ? Math.max(0, Math.trunc(best.vote_count))
            : null,
        popularity:
          typeof best.popularity === 'number' &&
          Number.isFinite(best.popularity)
            ? Number(best.popularity)
            : null,
        sources: ['google'],
      };

      const bucket = classifyReleaseDate(candidate.releaseDate, params.today);
      if (bucket === 'released') released.push(candidate);
      else if (bucket === 'upcoming') upcoming.push(candidate);
      else unknown.push(candidate);
      added += 1;
    }

    return { added, released, upcoming, unknown };
  }

  private async resolveGoogleTitlesToTmdbTvCandidates(params: {
    tmdbApiKey: string;
    titles: Array<{ title: string; year: number | null }>;
    today: string;
  }): Promise<{
    added: number;
    released: RecCandidate[];
    upcoming: RecCandidate[];
    unknown: RecCandidate[];
  }> {
    const released: RecCandidate[] = [];
    const upcoming: RecCandidate[] = [];
    const unknown: RecCandidate[] = [];
    let added = 0;

    for (const t of params.titles) {
      const title = (t?.title ?? '').trim();
      if (!title) continue;
      const year =
        typeof t.year === 'number' && Number.isFinite(t.year)
          ? Math.trunc(t.year)
          : null;

      const results = await this.tmdb
        .searchTv({
          apiKey: params.tmdbApiKey,
          query: title,
          firstAirDateYear: year,
          includeAdult: false,
        })
        .catch(() => []);

      const best = results[0] ?? null;
      if (!best) continue;

      const releaseDate =
        typeof best.first_air_date === 'string' && best.first_air_date.trim()
          ? best.first_air_date.trim()
          : null;
      const candidate: RecCandidate = {
        tmdbId: best.id,
        title: best.name,
        releaseDate,
        voteAverage:
          typeof best.vote_average === 'number' &&
          Number.isFinite(best.vote_average)
            ? Number(best.vote_average)
            : null,
        voteCount:
          typeof best.vote_count === 'number' && Number.isFinite(best.vote_count)
            ? Math.max(0, Math.trunc(best.vote_count))
            : null,
        popularity:
          typeof best.popularity === 'number' && Number.isFinite(best.popularity)
            ? Number(best.popularity)
            : null,
        sources: ['google'],
      };

      const bucket = classifyReleaseDate(candidate.releaseDate, params.today);
      if (bucket === 'released') released.push(candidate);
      else if (bucket === 'upcoming') upcoming.push(candidate);
      else unknown.push(candidate);
      added += 1;
    }

    return { added, released, upcoming, unknown };
  }
}

function buildGoogleQuery(
  seedMeta: Record<string, unknown>,
  currentYear: number,
): string {
  const nowYear = Number.isFinite(currentYear)
    ? currentYear
    : new Date().getFullYear();
  const nextYear = nowYear + 1;

  const genresRaw = seedMeta['genres'];
  const genres = Array.isArray(genresRaw)
    ? genresRaw
        .map((g) => (typeof g === 'string' ? g.trim() : ''))
        .filter(Boolean)
    : [];

  const seedTitle =
    typeof seedMeta['title'] === 'string'
      ? seedMeta['title'].trim()
      : typeof seedMeta['seed_title'] === 'string'
        ? seedMeta['seed_title'].trim()
        : '';

  if (genres.length) {
    const g = genres.slice(0, 2).join(' ');
    return `most anticipated upcoming ${g} movies ${nowYear} ${nextYear}`.trim();
  }
  if (seedTitle) {
    return `most anticipated upcoming movies like ${seedTitle} ${nowYear} ${nextYear}`.trim();
  }
  return `most anticipated upcoming movies ${nowYear} ${nextYear}`.trim();
}

function buildGoogleQueryTv(
  seedMeta: Record<string, unknown>,
  currentYear: number,
): string {
  const nowYear = Number.isFinite(currentYear)
    ? currentYear
    : new Date().getFullYear();
  const nextYear = nowYear + 1;

  const genresRaw = seedMeta['genres'];
  const genres = Array.isArray(genresRaw)
    ? genresRaw
        .map((g) => (typeof g === 'string' ? g.trim() : ''))
        .filter(Boolean)
    : [];

  const seedTitle =
    typeof seedMeta['title'] === 'string'
      ? seedMeta['title'].trim()
      : typeof seedMeta['seed_title'] === 'string'
        ? seedMeta['seed_title'].trim()
        : '';

  if (genres.length) {
    const g = genres.slice(0, 2).join(' ');
    return `most anticipated upcoming ${g} tv shows ${nowYear} ${nextYear}`.trim();
  }
  if (seedTitle) {
    return `most anticipated upcoming tv shows like ${seedTitle} ${nowYear} ${nextYear}`.trim();
  }
  return `most anticipated upcoming tv shows ${nowYear} ${nextYear}`.trim();
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreAndSortCandidates(
  candidates: Array<{
    tmdbId: number;
    title: string;
    releaseDate: string | null;
    voteAverage: number | null;
    voteCount: number | null;
    popularity: number | null;
    sources: string[];
  }>,
  params: { kind: 'released' | 'upcoming' },
): Array<{
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  popularity: number | null;
  sources: string[];
  score: number;
}> {
  const sourceBoost = (sources: string[]) => {
    const s = new Set(sources);
    let boost = 0;
    if (s.has('recommendations')) boost += 1.0;
    if (s.has('similar')) boost += 0.6;
    if (s.has('discover_released')) boost += 0.25;
    if (s.has('discover_upcoming')) boost += 0.25;
    if (s.has('google')) boost += 0.3;
    return boost;
  };

  const scored = candidates.map((c) => {
    const voteAvg = c.voteAverage ?? 0;
    const voteCount = c.voteCount ?? 0;
    const pop = c.popularity ?? 0;
    const votes = Math.log10(Math.max(1, voteCount + 1));
    const boost = sourceBoost(c.sources ?? []);

    const score =
      params.kind === 'released'
        ? voteAvg * 2 + votes + pop * 0.02 + boost
        : pop * 0.05 + voteAvg + votes * 0.25 + boost;

    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function selectWithSplit(params: {
  count: number;
  upcomingTarget: number;
  releasedPool: Array<{
    tmdbId: number;
    title: string;
    score: number;
  }>;
  upcomingPool: Array<{
    tmdbId: number;
    title: string;
    score: number;
  }>;
  unknownPool: Array<{
    tmdbId: number;
    title: string;
    score: number;
  }>;
}): { titles: string[]; releasedCount: number; upcomingCount: number } {
  const selected: string[] = [];
  const usedIds = new Set<number>();
  const usedTitleKeys = new Set<string>();

  const add = (c: { tmdbId: number; title: string }) => {
    const id = Number.isFinite(c.tmdbId) ? Math.trunc(c.tmdbId) : NaN;
    if (!Number.isFinite(id) || id <= 0) return false;
    const title = (c.title ?? '').trim();
    if (!title) return false;
    if (usedIds.has(id)) return false;
    const key = normalizeTitleKey(title);
    if (!key) return false;
    if (usedTitleKeys.has(key)) return false;
    usedIds.add(id);
    usedTitleKeys.add(key);
    selected.push(title);
    return true;
  };

  let upcomingCount = 0;
  for (const c of params.upcomingPool) {
    if (upcomingCount >= params.upcomingTarget) break;
    if (add(c)) upcomingCount += 1;
  }

  const releasedTargetEffective = Math.max(0, params.count - upcomingCount);
  let releasedCount = 0;
  for (const c of params.releasedPool) {
    if (releasedCount >= releasedTargetEffective) break;
    if (add(c)) releasedCount += 1;
  }

  // Backfill if still short: unknown -> released -> upcoming
  for (const c of params.unknownPool) {
    if (selected.length >= params.count) break;
    add(c);
  }
  for (const c of params.releasedPool) {
    if (selected.length >= params.count) break;
    add(c);
  }
  for (const c of params.upcomingPool) {
    if (selected.length >= params.count) break;
    add(c);
  }

  return {
    titles: selected.slice(0, params.count),
    releasedCount,
    upcomingCount,
  };
}

function mergeCandidatePools<T extends { tmdbId: number; sources: string[] }>(
  base: T[],
  extra: T[],
  source: string,
): T[] {
  const byId = new Map<number, T>();
  for (const c of base) byId.set(c.tmdbId, c);
  for (const c of extra) {
    const existing = byId.get(c.tmdbId);
    if (!existing) {
      byId.set(c.tmdbId, {
        ...c,
        sources: Array.from(new Set([...(c.sources ?? []), source])),
      });
      continue;
    }
    byId.set(c.tmdbId, {
      ...existing,
      ...c,
      sources: Array.from(
        new Set([...(existing.sources ?? []), ...(c.sources ?? []), source]),
      ),
    });
  }
  return Array.from(byId.values());
}

function uniqueByTmdbId<T extends { tmdbId: number }>(items: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<number>();
  for (const it of items) {
    const id = Number.isFinite(it?.tmdbId) ? Math.trunc(it.tmdbId) : NaN;
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

function classifyReleaseDate(
  releaseDate: string | null,
  today: string,
): 'released' | 'upcoming' | 'unknown' {
  const d = (releaseDate ?? '').trim();
  if (!d) return 'unknown';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'unknown';
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(today) && d > today)
    return 'upcoming';
  return 'released';
}

function parseTitleYearCandidates(
  titles: string[],
  limit = 200,
): Array<{ title: string; year: number | null }> {
  const out: Array<{ title: string; year: number | null }> = [];
  const seen = new Set<string>();
  const max = Math.max(1, Math.min(500, Math.trunc(limit || 200)));

  for (const raw of titles ?? []) {
    let s = String(raw ?? '').trim();
    if (!s) continue;

    // Remove bullet / numbering prefixes
    s = s.replace(/^\s*[-*\u2022]\s*/, '');
    s = s.replace(/^\s*\d+[.)]\s*/, '');

    let year: number | null = null;
    let m = s.match(/\(\s*(19\d{2}|20\d{2})\s*\)\s*$/);
    if (m) {
      year = Number(m[1]);
      s = s.replace(/\(\s*(19\d{2}|20\d{2})\s*\)\s*$/, '').trim();
    } else {
      m = s.match(/\s*[-–—]\s*(19\d{2}|20\d{2})\s*$/);
      if (m) {
        year = Number(m[1]);
        s = s.replace(/\s*[-–—]\s*(19\d{2}|20\d{2})\s*$/, '').trim();
      }
    }

    // Remove surrounding quotes
    s = s
      .trim()
      .replace(/^["']+/, '')
      .replace(/["']+$/, '')
      .trim();

    if (!s) continue;
    const key = normalizeTitleKey(s);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: s, year: Number.isFinite(year) ? (year as number) : null });
    if (out.length >= max) break;
  }

  return out;
}

function extractMovieTitleCandidatesFromGoogle(
  results: Array<{ title: string; snippet: string; link: string }>,
  limit: number,
): Array<{ title: string; year: number | null }> {
  const out: Array<{ title: string; year: number | null }> = [];
  const seen = new Set<string>();

  const push = (title: string, year: number | null) => {
    const t = title.trim();
    if (!t) return;
    const key = normalizeTitleKey(t);
    if (!key) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title: t, year });
  };

  const extract = (text: string) => {
    const t = text || '';
    const re =
      /([A-Z][A-Za-z0-9:'’\-&.,! ]{2,80}?)\s*\(\s*(19\d{2}|20\d{2})\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const title = (m[1] ?? '').trim();
      const year = m[2] ? Number.parseInt(m[2], 10) : NaN;
      push(title, Number.isFinite(year) ? year : null);
      if (out.length >= limit) return;
    }
  };

  for (const r of results) {
    if (out.length >= limit) break;
    const title = (r?.title ?? '').trim();
    if (title) {
      // Prefer anything before separators in page titles
      const beforeSep = title.split(/[|–—•-]/)[0]?.trim() ?? '';
      if (beforeSep && beforeSep.length <= 90) push(beforeSep, null);
      extract(title);
    }
    extract(r?.snippet ?? '');
  }

  return out.slice(0, limit);
}
