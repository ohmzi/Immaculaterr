import { Injectable } from '@nestjs/common';
import { GoogleService } from '../google/google.service';
import { OpenAiService } from '../openai/openai.service';
import { TmdbService } from '../tmdb/tmdb.service';
import type { JobContext, JsonObject } from '../jobs/jobs.types';

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
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
    openai?: { apiKey: string; model?: string | null } | null;
    google?: { apiKey: string; searchEngineId: string } | null;
  }): Promise<{
    titles: string[];
    strategy: 'openai' | 'tmdb';
    debug: JsonObject;
  }> {
    const { ctx } = params;
    const seedTitle = params.seedTitle.trim();
    const count = Math.max(1, Math.min(50, Math.trunc(params.count || 15)));
    const webFrac = clamp01(params.webContextFraction);

    const seedMeta = await this.tmdb.getSeedMetadata({
      apiKey: params.tmdbApiKey,
      seedTitle,
      seedYear: params.seedYear ?? null,
    });

    const openAiEnabled = Boolean(params.openai?.apiKey?.trim());
    const googleEnabled =
      openAiEnabled &&
      Boolean(params.google?.apiKey?.trim()) &&
      Boolean(params.google?.searchEngineId?.trim());

    let googleContext: string | null = null;
    let googleQuery: string | null = null;
    let googleMeta: JsonObject | null = null;

    if (googleEnabled) {
      const desiredGoogleResults = Math.min(50, Math.max(0, Math.ceil(count * webFrac)));
      if (desiredGoogleResults > 0) {
        googleQuery = buildGoogleQuery(seedMeta, new Date().getFullYear());
        await ctx.info('recs: google search', {
          query: googleQuery,
          requested: desiredGoogleResults,
        });

        try {
          const { results, meta } = await this.google.search({
            apiKey: params.google!.apiKey,
            cseId: params.google!.searchEngineId,
            query: googleQuery,
            numResults: desiredGoogleResults,
          });
          googleContext = results.length ? this.google.formatForPrompt(results) : null;
          googleMeta = { ...meta };
          await ctx.info('recs: google done', { ...meta });
        } catch (err) {
          await ctx.warn('recs: google failed (continuing without web context)', {
            error: (err as Error)?.message ?? String(err),
          });
          googleContext = null;
          googleMeta = { failed: true };
        }
      } else {
        googleMeta = { skipped: true, reason: 'webContextFraction=0' };
      }
    }

    if (openAiEnabled) {
      await ctx.info('recs: openai start', {
        model: (params.openai?.model ?? 'gpt-5.2-chat-latest') || 'gpt-5.2-chat-latest',
        count,
        googleUsed: Boolean(googleContext),
        upcomingCapFraction: webFrac,
      });
      try {
        const titles = await this.openai.getRelatedMovieTitles({
          apiKey: params.openai!.apiKey,
          model: params.openai!.model ?? null,
          seedTitle,
          limit: count,
          tmdbSeedMetadata: seedMeta,
          googleSearchContext: googleContext,
          upcomingCapFraction: webFrac,
        });

        const cleaned = cleanTitles(titles, count);
        if (cleaned.length) {
          await ctx.info('recs: openai done', { returned: cleaned.length });
          return {
            titles: cleaned,
            strategy: 'openai',
            debug: {
              googleEnabled,
              googleQuery,
              googleMeta: googleMeta ?? null,
              openAiEnabled: true,
            },
          };
        }

        await ctx.warn('recs: openai returned empty (falling back to tmdb)');
      } catch (err) {
        await ctx.warn('recs: openai failed (falling back to tmdb)', {
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    await ctx.info('recs: tmdb fallback start', { count });
    const tmdbTitles = await this.tmdb.getAdvancedMovieRecommendations({
      apiKey: params.tmdbApiKey,
      seedTitle,
      seedYear: params.seedYear ?? null,
      limit: count,
      includeAdult: false,
    });
    const cleaned = cleanTitles(tmdbTitles, count);
    await ctx.info('recs: tmdb fallback done', { returned: cleaned.length });
    return {
      titles: cleaned,
      strategy: 'tmdb',
      debug: {
        googleEnabled,
        googleQuery,
        googleMeta: googleMeta ?? null,
        openAiEnabled,
      },
    };
  }

  async buildChangeOfTasteMovieTitles(params: {
    ctx: JobContext;
    seedTitle: string;
    seedYear?: number | null;
    tmdbApiKey: string;
    count: number;
    openai?: { apiKey: string; model?: string | null } | null;
  }): Promise<{ titles: string[]; strategy: 'openai' | 'tmdb' }> {
    const { ctx } = params;
    const seedTitle = params.seedTitle.trim();
    const count = Math.max(1, Math.min(50, Math.trunc(params.count || 15)));

    const openAiEnabled = Boolean(params.openai?.apiKey?.trim());
    if (openAiEnabled) {
      await ctx.info('change_of_taste: openai start', {
        model: (params.openai?.model ?? 'gpt-5.2-chat-latest') || 'gpt-5.2-chat-latest',
        count,
      });
      try {
        const titles = await this.openai.getContrastMovieTitles({
          apiKey: params.openai!.apiKey,
          model: params.openai!.model ?? null,
          seedTitle,
          limit: count,
        });
        const cleaned = cleanTitles(titles, count);
        await ctx.info('change_of_taste: openai done', { returned: cleaned.length });
        if (cleaned.length) return { titles: cleaned, strategy: 'openai' };
        await ctx.warn('change_of_taste: openai returned empty (falling back to tmdb)');
      } catch (err) {
        await ctx.warn('change_of_taste: openai failed (falling back to tmdb)', {
          error: (err as Error)?.message ?? String(err),
        });
      }
    }

    await ctx.info('change_of_taste: tmdb fallback start', { count });
    const tmdbTitles = await this.tmdb.getContrastMovieRecommendations({
      apiKey: params.tmdbApiKey,
      seedTitle,
      seedYear: params.seedYear ?? null,
      limit: count,
    });
    const cleaned = cleanTitles(tmdbTitles, count);
    await ctx.info('change_of_taste: tmdb fallback done', { returned: cleaned.length });
    return { titles: cleaned, strategy: 'tmdb' };
  }
}

function buildGoogleQuery(seedMeta: Record<string, unknown>, currentYear: number): string {
  const nowYear = Number.isFinite(currentYear) ? currentYear : new Date().getFullYear();
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


