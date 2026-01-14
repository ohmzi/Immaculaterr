const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
};

function fromCodePointSafe(cp: number): string | null {
  if (!Number.isFinite(cp)) return null;
  const n = Math.trunc(cp);
  // Basic validity guard (avoid surrogates + out of range)
  if (n < 0 || n > 0x10ffff) return null;
  if (n >= 0xd800 && n <= 0xdfff) return null;
  try {
    return String.fromCodePoint(n);
  } catch {
    return null;
  }
}

/**
 * Decode a conservative subset of HTML entities without pulling in dependencies:
 * - numeric decimal: &#183;
 * - numeric hex: &#xB7;
 * - a few named entities: &amp; &lt; &gt; &quot; &apos; &nbsp; &middot;
 */
export function decodeHtmlEntities(input: string): string {
  let s = input ?? '';
  if (!s) return '';

  // Hex numeric entities
  s = s.replace(/&#x([0-9a-fA-F]{1,8});/g, (_m, hex: string) => {
    const cp = Number.parseInt(hex, 16);
    return fromCodePointSafe(cp) ?? _m;
  });

  // Decimal numeric entities
  s = s.replace(/&#([0-9]{1,8});/g, (_m, dec: string) => {
    const cp = Number.parseInt(dec, 10);
    return fromCodePointSafe(cp) ?? _m;
  });

  // Named entities (small allowlist)
  s = s.replace(/&([a-zA-Z]{2,12});/g, (_m, name: string) => {
    const key = name.toLowerCase();
    return NAMED_ENTITIES[key] ?? _m;
  });

  return s;
}

/**
 * Normalize titles coming from Plex (or persisted webhook payloads):
 * - decode common numeric entities (e.g. WALL&#183;E -> WALL·E)
 * - normalize Unicode (NFKC)
 * - normalize whitespace + a few punctuation variants
 */
export function normalizeTitleForMatching(raw: string): string {
  let s = decodeHtmlEntities(raw ?? '').trim();
  if (!s) return '';

  try {
    s = s.normalize('NFKC');
  } catch {
    // ignore
  }

  // Whitespace normalization
  s = s
    .replace(/\u00a0/g, ' ') // nbsp
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, '') // zero-width + bidi marks
    .replace(/\s+/g, ' ')
    .trim();

  // Punctuation normalization (conservative)
  s = s
    .replace(/[\u2018\u2019\u02bc]/g, "'") // curly apostrophes
    .replace(/[\u201c\u201d]/g, '"') // curly quotes
    .replace(/[\u2013\u2014]/g, '-') // en/em dash
    .trim();

  return s;
}

export function buildTitleQueryVariants(title: string): string[] {
  const base = normalizeTitleForMatching(title);
  if (!base) return [];

  const variants: string[] = [];
  const push = (v: string) => {
    const t = v.trim();
    if (!t) return;
    if (!variants.includes(t)) variants.push(t);
  };

  push(base);

  // Common punctuation/spacing variations
  push(base.replace(/·/g, ' ').replace(/\s+/g, ' ').trim());
  push(base.replace(/·/g, '').replace(/\s+/g, ' ').trim());
  push(base.replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim());
  push(base.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()); // strip punctuation

  return variants.slice(0, 8);
}

