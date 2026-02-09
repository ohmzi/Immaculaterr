"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const bootstrap_env_1 = require("../bootstrap-env");
const crypto_service_1 = require("../crypto/crypto.service");
const prisma_service_1 = require("../db/prisma.service");
const google_service_1 = require("../google/google.service");
const openai_service_1 = require("../openai/openai.service");
const recommendations_service_1 = require("../recommendations/recommendations.service");
const settings_service_1 = require("../settings/settings.service");
const tmdb_service_1 = require("../tmdb/tmdb.service");
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function pick(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const part of parts) {
        if (!isPlainObject(cur))
            return undefined;
        cur = cur[part];
    }
    return cur;
}
function pickString(obj, path) {
    const v = pick(obj, path);
    return typeof v === 'string' ? v.trim() : '';
}
function pickBool(obj, path) {
    const v = pick(obj, path);
    return typeof v === 'boolean' ? v : null;
}
function pickNumber(obj, path) {
    const v = pick(obj, path);
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim()) {
        const n = Number.parseFloat(v.trim());
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function clampInt(value, min, max, fallback) {
    const n = typeof value === 'number' && Number.isFinite(value)
        ? Math.trunc(value)
        : typeof value === 'string' && value.trim()
            ? Number.parseInt(value.trim(), 10)
            : fallback;
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(min, Math.min(max, n));
}
function formatYmdInTz(date, timeZone) {
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
        if (y && m && d)
            return `${y}-${m}-${d}`;
    }
    catch {
    }
    return date.toISOString().slice(0, 10);
}
function classifyReleaseDate(releaseDate, today) {
    const d = typeof releaseDate === 'string' ? releaseDate.trim() : '';
    if (!d)
        return 'unknown';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        return 'unknown';
    if (today && /^\d{4}-\d{2}-\d{2}$/.test(today) && d > today)
        return 'upcoming';
    return 'released';
}
async function main() {
    await (0, bootstrap_env_1.ensureBootstrapEnv)();
    const seedTitle = process.argv.slice(2).join(' ').trim() || 'The Matrix';
    const tz = 'America/Toronto';
    const today = formatYmdInTz(new Date(), tz);
    const prisma = new prisma_service_1.PrismaService();
    await prisma.$connect();
    const crypto = new crypto_service_1.CryptoService();
    await crypto.onModuleInit();
    const settingsService = new settings_service_1.SettingsService(prisma, crypto);
    const user = await prisma.user.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true, username: true },
    });
    if (!user) {
        throw new Error('No admin user exists. Open the web UI and complete onboarding first.');
    }
    const { settings, secrets } = await settingsService.getInternalSettings(user.id);
    const tmdbApiKey = pickString(secrets, 'tmdb.apiKey') ||
        pickString(secrets, 'tmdbApiKey') ||
        pickString(secrets, 'tmdb.api_key');
    if (!tmdbApiKey) {
        throw new Error('TMDB apiKey is not set (Vault → TMDB).');
    }
    const count = clampInt(pickNumber(settings, 'recommendations.count') ?? 10, 5, 100, 10);
    const upcomingPercent = clampInt(pickNumber(settings, 'recommendations.upcomingPercent') ?? 25, 0, 75, 25);
    const webContextFraction = pickNumber(settings, 'recommendations.webContextFraction') ??
        pickNumber(settings, 'recommendations.web_context_fraction') ??
        0.3;
    const openAiEnabledFlag = pickBool(settings, 'openai.enabled') ?? false;
    const openAiApiKey = pickString(secrets, 'openai.apiKey');
    const openAiModel = pickString(settings, 'openai.model') || null;
    const openAiEnabled = openAiEnabledFlag && Boolean(openAiApiKey);
    const googleEnabledFlag = pickBool(settings, 'google.enabled') ?? false;
    const googleApiKey = pickString(secrets, 'google.apiKey');
    const googleSearchEngineId = pickString(settings, 'google.searchEngineId');
    const googleEnabled = googleEnabledFlag && Boolean(googleApiKey) && Boolean(googleSearchEngineId);
    const tmdb = new tmdb_service_1.TmdbService();
    const google = new google_service_1.GoogleService();
    const openai = new openai_service_1.OpenAiService();
    const recs = new recommendations_service_1.RecommendationsService(tmdb, google, openai);
    const logs = [];
    let summaryCache = null;
    const ctx = {
        jobId: 'dryRunRecommendations',
        runId: (0, node_crypto_1.randomUUID)(),
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
    console.log('\n=== DRY RUN: Recommendations ===');
    console.log(JSON.stringify({
        seedTitle,
        resolvedSeed: seedMeta,
        today,
        config: {
            count,
            upcomingPercent,
            webContextFraction,
            services: { tmdb: true, googleEnabled, openAiEnabled },
        },
    }, null, 2));
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
    const released = [];
    const upcoming = [];
    const unknown = [];
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
        const releaseDate = best && typeof best.release_date === 'string' && best.release_date.trim()
            ? best.release_date.trim()
            : null;
        const bucket = classifyReleaseDate(releaseDate, today);
        const row = { title, releaseDate };
        if (bucket === 'released')
            released.push(row);
        else if (bucket === 'upcoming')
            upcoming.push(row);
        else
            unknown.push(row);
    }
    console.log('\n=== FINAL RESULT ===');
    console.log(JSON.stringify({
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
    }, null, 2));
    console.log('\n--- Released recommendations ---');
    for (const r of released) {
        console.log(`- ${r.title}${r.releaseDate ? ` (${r.releaseDate})` : ''}`);
    }
    console.log('\n--- Upcoming recommendations ---');
    for (const r of upcoming) {
        console.log(`- ${r.title}${r.releaseDate ? ` (${r.releaseDate})` : ''}`);
    }
    if (unknown.length) {
        console.log('\n--- Unknown release date (TMDB search could not classify) ---');
        for (const r of unknown) {
            console.log(`- ${r.title}${r.releaseDate ? ` (${r.releaseDate})` : ''}`);
        }
    }
}
void main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exitCode = 1;
});
//# sourceMappingURL=dry-run-recommendations.js.map