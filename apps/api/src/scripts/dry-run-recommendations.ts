import { randomUUID } from 'node:crypto';
import { ensureBootstrapEnv } from '../bootstrap-env';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../db/prisma.service';
import { GoogleService } from '../google/google.service';
import type { JobContext, JobLogLevel, JsonObject } from '../jobs/jobs.types';
import { OpenAiService } from '../openai/openai.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { SettingsService } from '../settings/settings.service';
import { TmdbService } from '../tmdb/tmdb.service';

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

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.trunc(value)
      : typeof value === 'string' && value.trim()
        ? Number.parseInt(value.trim(), 10)
        : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function formatYmdInTz(date: Date, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    const d = parts.find((p) => p.type === 'day')?.value ?? '';
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // ignore
  }
  return date.toISOString().slice(0, 10);
}

function classifyReleaseDate(
  releaseDate: string | null | undefined,
  today: string,
): 'released' | 'upcoming' | 'unknown' {
  const d = typeof releaseDate === 'string' ? releaseDate.trim() : '';
  if (!d) return 'unknown';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'unknown';
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(today) && d > today) return 'upcoming';
  return 'released';
}

async function main() {
  await ensureBootstrapEnv();

  const seedTitle = process.argv.slice(2).join(' ').trim() || 'The Matrix';
  const tz = 'America/Toronto';
  const today = formatYmdInTz(new Date(), tz);

  const prisma = new PrismaService();
  await prisma.$connect();

  const crypto = new CryptoService();
  await crypto.onModuleInit();

  const settingsService = new SettingsService(prisma, crypto);

  const user = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, username: true },
  });
  if (!user) {
    throw new Error('No admin user exists. Open the web UI and complete onboarding first.');
  }

  const { settings, secrets } = await settingsService.getInternalSettings(user.id);

  const tmdbApiKey =
    pickString(secrets, 'tmdb.apiKey') ||
    pickString(secrets, 'tmdbApiKey') ||
    pickString(secrets, 'tmdb.api_key');
  if (!tmdbApiKey) {
    throw new Error('TMDB apiKey is not set (Vault → TMDB).');
  }

  const count = clampInt(pickNumber(settings, 'recommendations.count') ?? 10, 5, 100, 10);
  const upcomingPercent = clampInt(
    pickNumber(settings, 'recommendations.upcomingPercent') ?? 25,
    0,
    75,
    25,
  );
  const webContextFraction =
    pickNumber(settings, 'recommendations.webContextFraction') ??
    pickNumber(settings, 'recommendations.web_context_fraction') ??
    0.3;

  const openAiEnabledFlag = pickBool(settings, 'openai.enabled') ?? false;
  const openAiApiKey = pickString(secrets, 'openai.apiKey');
  const openAiModel = pickString(settings, 'openai.model') || null;
  const openAiEnabled = openAiEnabledFlag && Boolean(openAiApiKey);

  const googleEnabledFlag = pickBool(settings, 'google.enabled') ?? false;
  const googleApiKey = pickString(secrets, 'google.apiKey');
  const googleSearchEngineId = pickString(settings, 'google.searchEngineId');
  const googleEnabled =
    googleEnabledFlag && Boolean(googleApiKey) && Boolean(googleSearchEngineId);

  const tmdb = new TmdbService();
  const google = new GoogleService();
  const openai = new OpenAiService();
  const recs = new RecommendationsService(tmdb, google, openai);

  const logs: Array<{ level: JobLogLevel; message: string; context?: JsonObject }> = [];
  let summaryCache: JsonObject | null = null;
  const ctx: JobContext = {
    jobId: 'dryRunRecommendations',
    runId: randomUUID(),
    userId: user.id,
    dryRun: true,
    trigger: 'manual',
    input: { seedTitle },
    getSummary: () => summaryCache,
    setSummary: async (summary) => {
      summaryCache = summary ?? null;
    },
    patchSummary: async (patch) => {
      summaryCache = { ...(summaryCache ?? {}), ...(patch ?? {}) };
    },
    log: async (level, message, context) => {
      logs.push({ level, message, context });
      const ctxText = context ? ` ${JSON.stringify(context)}` : '';
      // eslint-disable-next-line no-console
      console.log(`[${level}] ${message}${ctxText}`);
    },
    debug: async (m, c) => ctx.log('debug', m, c),
    info: async (m, c) => ctx.log('info', m, c),
    warn: async (m, c) => ctx.log('warn', m, c),
    error: async (m, c) => ctx.log('error', m, c),
  };

  const seedMeta = await tmdb.getSeedMetadata({
    apiKey: tmdbApiKey,
    seedTitle,
    seedYear: null,
  });

  // eslint-disable-next-line no-console
  console.log('\n=== DRY RUN: Recommendations ===');
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        seedTitle,
        resolvedSeed: seedMeta,
        today,
        config: {
          count,
          upcomingPercent,
          webContextFraction,
          services: { tmdb: true, googleEnabled, openAiEnabled },
        },
      },
      null,
      2,
    ),
  );
  // eslint-disable-next-line no-console
  console.log('==============================\n');

  const result = await recs.buildSimilarMovieTitles({
    ctx,
    seedTitle,
    seedYear: null,
    tmdbApiKey,
    count,
    webContextFraction,
    upcomingPercent,
    openai: openAiEnabled ? { apiKey: openAiApiKey, model: openAiModel } : null,
    google: googleEnabled
      ? { apiKey: googleApiKey, searchEngineId: googleSearchEngineId }
      : null,
  });

  // Classify final recommendations by release_date (best-effort TMDB search).
  const released: Array<{ title: string; releaseDate: string | null }> = [];
  const upcoming: Array<{ title: string; releaseDate: string | null }> = [];
  const unknown: Array<{ title: string; releaseDate: string | null }> = [];

  for (const title of result.titles) {
    const matches = await tmdb
      .searchMovie({
        apiKey: tmdbApiKey,
        query: title,
        year: null,
        includeAdult: false,
      })
      .catch(() => []);
    const best = matches[0] ?? null;
    const releaseDate =
      best && typeof best.release_date === 'string' && best.release_date.trim()
        ? best.release_date.trim()
        : null;
    const bucket = classifyReleaseDate(releaseDate, today);
    const row = { title, releaseDate };
    if (bucket === 'released') released.push(row);
    else if (bucket === 'upcoming') upcoming.push(row);
    else unknown.push(row);
  }

  // eslint-disable-next-line no-console
  console.log('\n=== FINAL RESULT ===');
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        seedTitle,
        resolvedSeed: seedMeta,
        strategy: result.strategy,
        counts: {
          total: result.titles.length,
          released: released.length,
          upcoming: upcoming.length,
          unknown: unknown.length,
        },
        debug: result.debug,
      },
      null,
      2,
    ),
  );

  // eslint-disable-next-line no-console
  console.log('\n--- Released recommendations ---');
  for (const r of released) {
    // eslint-disable-next-line no-console
    console.log(`- ${r.title}${r.releaseDate ? ` (${r.releaseDate})` : ''}`);
  }

  // eslint-disable-next-line no-console
  console.log('\n--- Upcoming recommendations ---');
  for (const r of upcoming) {
    // eslint-disable-next-line no-console
    console.log(`- ${r.title}${r.releaseDate ? ` (${r.releaseDate})` : ''}`);
  }

  if (unknown.length) {
    // eslint-disable-next-line no-console
    console.log('\n--- Unknown release date (TMDB search could not classify) ---');
    for (const r of unknown) {
      // eslint-disable-next-line no-console
      console.log(`- ${r.title}${r.releaseDate ? ` (${r.releaseDate})` : ''}`);
    }
  }
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});




