import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

type OpenAiModelsResponse = {
  data?: unknown;
};

type OpenAiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OpenAiChatCompletionsResponse = {
  choices?: unknown;
};

type MovieCandidateForSelection = {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  popularity?: number | null;
  sources?: string[] | null;
};

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);

  async testConnection(params: { apiKey: string }) {
    const apiKey = params.apiKey.trim();

    this.logger.log('Testing OpenAI connection');

    const url = 'https://api.openai.com/v1/models';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await this.extractOpenAiError(res);
        throw new BadGatewayException(
          `OpenAI test failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`.trim(),
        );
      }

      const data = (await res.json()) as OpenAiModelsResponse;
      const models = Array.isArray(data.data)
        ? (data.data as Array<Record<string, unknown>>)
        : [];
      const ids = models
        .map((m) => (typeof m['id'] === 'string' ? m['id'] : null))
        .filter((x): x is string => Boolean(x));

      return {
        ok: true,
        meta: {
          count: ids.length,
          sample: ids.slice(0, 10),
        },
      };
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `OpenAI test failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async extractOpenAiError(res: Response) {
    try {
      const payload = (await res.json()) as unknown;
      if (!payload || typeof payload !== 'object') return '';
      const err = (payload as Record<string, unknown>)['error'];
      if (!err || typeof err !== 'object') return '';

      const message = (err as Record<string, unknown>)['message'];
      const type = (err as Record<string, unknown>)['type'];
      const code = (err as Record<string, unknown>)['code'];

      return `message=${JSON.stringify(message)} type=${JSON.stringify(type)} code=${JSON.stringify(code)}`;
    } catch {
      try {
        const text = await res.text();
        return text ? `body=${JSON.stringify(text.slice(0, 300))}` : '';
      } catch {
        return '';
      }
    }
  }

  async chatCompletions(params: {
    apiKey: string;
    model: string;
    messages: OpenAiChatMessage[];
    timeoutMs?: number;
  }): Promise<string> {
    const apiKey = params.apiKey.trim();
    const model = params.model.trim();
    const timeoutMs = params.timeoutMs ?? 30000;

    if (!apiKey) throw new BadGatewayException('OpenAI apiKey is required');
    if (!model) throw new BadGatewayException('OpenAI model is required');

    const url = 'https://api.openai.com/v1/chat/completions';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: params.messages,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await this.extractOpenAiError(res);
        throw new BadGatewayException(
          `OpenAI chat.completions failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`.trim(),
        );
      }

      const data = (await res.json()) as OpenAiChatCompletionsResponse;
      const choicesRaw = data.choices;
      const choices = Array.isArray(choicesRaw)
        ? (choicesRaw as unknown[])
        : [];
      const first = choices[0];
      if (!first || typeof first !== 'object') return '';
      const message = (first as Record<string, unknown>)['message'];
      if (!message || typeof message !== 'object') return '';
      const content = (message as Record<string, unknown>)['content'];
      return typeof content === 'string' ? content : '';
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `OpenAI chat.completions failed: ${(err as Error)?.message ?? String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getRelatedMovieTitles(params: {
    apiKey: string;
    model?: string | null;
    seedTitle: string;
    limit: number;
    tmdbSeedMetadata?: Record<string, unknown> | null;
    googleSearchContext?: string | null;
    upcomingCapFraction?: number;
  }): Promise<string[]> {
    const seedTitle = params.seedTitle.trim();
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 25)));
    const model = (params.model ?? '').trim() || 'gpt-5.2-chat-latest';

    const fracRaw = params.upcomingCapFraction ?? 0.5;
    const frac = Number.isFinite(fracRaw)
      ? Math.max(0, Math.min(1, fracRaw))
      : 0.5;
    const upcomingCap = Math.max(0, Math.min(limit, Math.trunc(limit * frac)));

    const seedBlock = safeJsonString(params.tmdbSeedMetadata ?? {});
    const webBlock = (params.googleSearchContext ?? '').trim();

    const prompt = [
      `You are a movie recommendation engine.`,
      ``,
      `Seed title: ${seedTitle}`,
      `Desired count: ${limit}`,
      ``,
      `TMDb seed metadata (JSON):`,
      seedBlock || '{}',
      ``,
      `Web search snippets (may include upcoming releases):`,
      webBlock || '(none)',
      ``,
      `Return STRICT JSON only (no markdown, no prose) with this schema:`,
      `{`,
      `  "primary_recommendations": ["Title 1", "Title 2", "..."],`,
      `  "upcoming_from_search": ["Upcoming Title A", "Upcoming Title B", "..."]`,
      `}`,
      ``,
      `Rules:`,
      `- primary_recommendations should be mostly released movies similar in tone/themes/style to the seed.`,
      `- upcoming_from_search should include up to ${upcomingCap} items (max ${Math.round(frac * 100)}% of ${limit}).`,
      `- upcoming_from_search should include upcoming/unreleased movies that are relevant, preferably found in the web snippets.`,
      `- Avoid duplicates across both lists.`,
      `- Movie titles only (no years unless needed to disambiguate).`,
    ].join('\n');

    const text = await this.chatCompletions({
      apiKey: params.apiKey,
      model,
      messages: [
        { role: 'system', content: 'You are a movie recommendation engine.' },
        { role: 'user', content: prompt },
      ],
      timeoutMs: 45000,
    });

    const { primary, upcoming } = tryParseJsonRecs(text);
    if (primary.length || upcoming.length) {
      return mergePrimaryAndUpcoming(primary, upcoming, {
        limit,
        upcomingCapFraction: frac,
      });
    }

    return parseNewlineRecommendations(text, limit);
  }

  async getContrastMovieTitles(params: {
    apiKey: string;
    model?: string | null;
    seedTitle: string;
    limit: number;
  }): Promise<string[]> {
    const seedTitle = params.seedTitle.trim();
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 15)));
    const model = (params.model ?? '').trim() || 'gpt-5.2-chat-latest';

    const prompt = [
      `Recommend ${limit} movies that offer a deliberate "change of taste" from "${seedTitle}".`,
      `These should be opposite in tone, genre, pacing, or style.`,
      `For example, if the movie is dark and serious, recommend light comedies or uplifting films.`,
      `If it's action-packed, recommend slow-burn dramas or contemplative films.`,
      `If it's realistic, recommend fantasy or sci-fi.`,
      ``,
      `Return ONLY a plain newline-separated list of movie titles (no extra text, no numbering).`,
      `Do not include years unless necessary to disambiguate titles.`,
    ].join('\n');

    const text = await this.chatCompletions({
      apiKey: params.apiKey,
      model,
      messages: [
        { role: 'system', content: 'You are a movie recommendation engine.' },
        { role: 'user', content: prompt },
      ],
      timeoutMs: 45000,
    });

    return parseNewlineRecommendations(text, limit);
  }

  async getContrastTvTitles(params: {
    apiKey: string;
    model?: string | null;
    seedTitle: string;
    limit: number;
  }): Promise<string[]> {
    const seedTitle = params.seedTitle.trim();
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit || 15)));
    const model = (params.model ?? '').trim() || 'gpt-5.2-chat-latest';

    const prompt = [
      `Recommend ${limit} TV shows that offer a deliberate "change of taste" from "${seedTitle}".`,
      `These should be opposite in tone, genre, pacing, or style.`,
      `For example, if the show is dark and serious, recommend light comedies or uplifting series.`,
      `If it's action-packed, recommend slow-burn dramas or contemplative series.`,
      `If it's realistic, recommend fantasy or sci-fi.`,
      ``,
      `Return ONLY a plain newline-separated list of TV show titles (no extra text, no numbering).`,
      `Do not include years unless necessary to disambiguate titles.`,
    ].join('\n');

    const text = await this.chatCompletions({
      apiKey: params.apiKey,
      model,
      messages: [
        { role: 'system', content: 'You are a TV show recommendation engine.' },
        { role: 'user', content: prompt },
      ],
      timeoutMs: 45000,
    });

    return parseNewlineRecommendations(text, limit);
  }

  async selectFromCandidates(params: {
    apiKey: string;
    model?: string | null;
    seedTitle: string;
    mediaType?: 'movie' | 'tv';
    tmdbSeedMetadata?: Record<string, unknown> | null;
    releasedTarget: number;
    upcomingTarget: number;
    releasedCandidates: MovieCandidateForSelection[];
    upcomingCandidates: MovieCandidateForSelection[];
  }): Promise<{ released: number[]; upcoming: number[] }> {
    const seedTitle = params.seedTitle.trim();
    const model = (params.model ?? '').trim() || 'gpt-5.2-chat-latest';
    const mediaType = params.mediaType === 'tv' ? 'tv' : 'movie';
    const mediaLabel = mediaType === 'tv' ? 'TV show' : 'movie';
    const releasedTarget = Math.max(0, Math.trunc(params.releasedTarget ?? 0));
    const upcomingTarget = Math.max(0, Math.trunc(params.upcomingTarget ?? 0));

    const releasedSlim = (params.releasedCandidates ?? []).map((c) => ({
      tmdbId: c.tmdbId,
      title: c.title,
      releaseDate: c.releaseDate,
      voteAverage: c.voteAverage ?? null,
      voteCount: c.voteCount ?? null,
      popularity: c.popularity ?? null,
      sources: c.sources ?? null,
    }));
    const upcomingSlim = (params.upcomingCandidates ?? []).map((c) => ({
      tmdbId: c.tmdbId,
      title: c.title,
      releaseDate: c.releaseDate,
      popularity: c.popularity ?? null,
      sources: c.sources ?? null,
    }));

    const prompt = [
      `You are a ${mediaLabel} recommendation selector.`,
      ``,
      `Seed title: ${seedTitle}`,
      `TMDb seed metadata (JSON): ${safeJsonString(params.tmdbSeedMetadata ?? {})}`,
      ``,
      `You MUST select exactly:`,
      `- released: ${releasedTarget}`,
      `- upcoming: ${upcomingTarget}`,
      ``,
      `You may ONLY select from the candidates provided below.`,
      `Return STRICT JSON only with this schema:`,
      `{ "released": [123, 456], "upcoming": [789, 101] }`,
      ``,
      `Released candidates (JSON array):`,
      safeJsonString(releasedSlim),
      ``,
      `Upcoming candidates (JSON array):`,
      safeJsonString(upcomingSlim),
      ``,
      `Rules:`,
      `- Output MUST contain only tmdbId numbers from the candidate lists.`,
      `- Output MUST contain no duplicates across both arrays.`,
      `- If you cannot satisfy the exact counts, output empty arrays.`,
    ].join('\n');

    const text = await this.chatCompletions({
      apiKey: params.apiKey,
      model,
      messages: [
        {
          role: 'system',
          content:
            mediaType === 'tv'
              ? 'You select TV shows from provided candidates.'
              : 'You select movies from provided candidates.',
        },
        { role: 'user', content: prompt },
      ],
      timeoutMs: 45000,
    });

    const parsed = tryParseSelectionJson(text);
    if (!parsed) return { released: [], upcoming: [] };

    const releasedIds = parsed.released.slice(0, releasedTarget);
    const upcomingIds = parsed.upcoming.slice(0, upcomingTarget);

    // Validate membership + exact counts.
    const releasedSet = new Set(
      (params.releasedCandidates ?? []).map((c) => c.tmdbId),
    );
    const upcomingSet = new Set(
      (params.upcomingCandidates ?? []).map((c) => c.tmdbId),
    );

    const seen = new Set<number>();
    const clean = (ids: number[], allow: Set<number>) => {
      const out: number[] = [];
      for (const id of ids) {
        const n = Number.isFinite(id) ? Math.trunc(id) : NaN;
        if (!Number.isFinite(n) || n <= 0) continue;
        if (seen.has(n)) continue;
        if (!allow.has(n)) continue;
        seen.add(n);
        out.push(n);
      }
      return out;
    };

    const cleanReleased = clean(releasedIds, releasedSet);
    const cleanUpcoming = clean(upcomingIds, upcomingSet);

    if (
      cleanReleased.length !== releasedTarget ||
      cleanUpcoming.length !== upcomingTarget
    ) {
      return { released: [], upcoming: [] };
    }

    return { released: cleanReleased, upcoming: cleanUpcoming };
  }
}

function safeJsonString(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 0);
  } catch {
    return '{}';
  }
}

function cleanTitle(line: string): string | null {
  let s = line.trim();
  if (!s) return null;

  // Remove bullet / numbering prefixes
  s = s.replace(/^\s*[-*\u2022]\s*/, '');
  s = s.replace(/^\s*\d+[.)]\s*/, '');

  // Remove trailing year patterns
  s = s.replace(/\(\s*\d{4}\s*\)\s*$/, '');
  s = s.replace(/\s*[-–—]\s*\d{4}\s*$/, '');

  // Remove surrounding quotes
  s = s
    .trim()
    .replace(/^["']+/, '')
    .replace(/["']+$/, '')
    .trim();

  return s || null;
}

function parseNewlineRecommendations(text: string, limit: number): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const title = cleanTitle(line);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= limit) break;
  }

  return out;
}

function stripMarkdownFences(text: string): string {
  let t = text.trim();
  if (!t.startsWith('```')) return t;
  t = t.replace(/^```[a-zA-Z0-9_-]*\s*/, '').trim();
  t = t.replace(/\s*```$/, '').trim();
  return t;
}

function tryParseJsonRecs(text: string): {
  primary: string[];
  upcoming: string[];
} {
  if (!text || !text.trim()) return { primary: [], upcoming: [] };
  const t = stripMarkdownFences(text);
  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    return { primary: [], upcoming: [] };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    return { primary: [], upcoming: [] };

  const rec = obj as Record<string, unknown>;
  const primaryRaw = rec['primary_recommendations'];
  const upcomingRaw = rec['upcoming_from_search'];

  return {
    primary: cleanStringList(primaryRaw),
    upcoming: cleanStringList(upcomingRaw),
  };
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const title = cleanTitle(item);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

function mergePrimaryAndUpcoming(
  primary: string[],
  upcoming: string[],
  params: { limit: number; upcomingCapFraction: number },
): string[] {
  const limit = params.limit;
  if (limit <= 0) return [];

  const frac = Number.isFinite(params.upcomingCapFraction)
    ? Math.max(0, Math.min(1, params.upcomingCapFraction))
    : 0.5;
  const cap = Math.max(0, Math.min(limit, Math.trunc(limit * frac)));

  const out: string[] = [];
  const seen = new Set<string>();

  const add = (t: string) => {
    const title = t.trim();
    if (!title) return;
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(title);
  };

  // Add upcoming titles first (up to cap), then fill with primary, then backfill with upcoming.
  for (const t of upcoming) {
    if (out.length >= cap) break;
    add(t);
  }
  for (const t of primary) {
    if (out.length >= limit) break;
    add(t);
  }
  if (out.length < limit) {
    for (const t of upcoming) {
      if (out.length >= limit) break;
      add(t);
    }
  }

  return out.slice(0, limit);
}

function tryParseSelectionJson(
  text: string,
): { released: number[]; upcoming: number[] } | null {
  const t = stripMarkdownFences(text || '');
  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  return {
    released: coerceNumberList(rec['released']),
    upcoming: coerceNumberList(rec['upcoming']),
  };
}

function coerceNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of value) {
    const n =
      typeof v === 'number' && Number.isFinite(v)
        ? Math.trunc(v)
        : typeof v === 'string' && v.trim()
          ? Number.parseInt(v.trim(), 10)
          : NaN;
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
