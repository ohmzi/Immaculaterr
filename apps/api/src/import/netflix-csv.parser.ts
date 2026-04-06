export type ParsedNetflixEntry = {
  rawTitle: string;
  parsedTitle: string;
  watchedAt: Date | null;
};

const TV_PATTERNS = [
  /:\s*Season\b/i,
  /:\s*Limited Series\b/i,
  /:\s*Part\b/i,
  /:\s*Episode\b/i,
  /:\s*Chapter\b/i,
  /:\s*Volume\b/i,
  /:\s*Series\b/i,
  /:\s*Collection\b/i,
];

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

function stripTvPatterns(title: string): string {
  for (const pattern of TV_PATTERNS) {
    const match = title.search(pattern);
    if (match !== -1) return title.slice(0, match).trim();
  }
  return title.trim();
}

export type DateFormat = 'mdy' | 'dmy';

export function detectDateFormat(dateValues: string[]): DateFormat {
  for (const raw of dateValues) {
    const parts = raw.trim().split('/');
    if (parts.length < 2) continue;
    const first = Number.parseInt(parts[0], 10);
    const second = Number.parseInt(parts[1], 10);

    if (first > 12 && second <= 12) return 'dmy';
    if (second > 12 && first <= 12) return 'mdy';
  }
  return 'mdy';
}

function parseDate(raw: string, format: DateFormat): Date | null {
  const parts = raw.trim().split('/');
  if (parts.length < 3) return null;

  let month: number;
  let day: number;
  let year: number;

  if (format === 'dmy') {
    day = Number.parseInt(parts[0], 10);
    month = Number.parseInt(parts[1], 10);
    year = Number.parseInt(parts[2], 10);
  } else {
    month = Number.parseInt(parts[0], 10);
    day = Number.parseInt(parts[1], 10);
    year = Number.parseInt(parts[2], 10);
  }

  if (
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(year)
  ) {
    return null;
  }

  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return new Date(year, month - 1, day);
}

function parseCsvLine(line: unknown): string[] {
  const safeLine = typeof line === 'string' ? line : '';
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < safeLine.length; i++) {
    const ch = safeLine[i];
    if (inQuotes) {
      if (ch === '"' && safeLine[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export type ParseNetflixCsvResult = {
  entries: ParsedNetflixEntry[];
  totalRawRows: number;
};

export function parseNetflixCsv(buffer: Buffer): ParseNetflixCsvResult {
  const text = stripBom(buffer.toString('utf-8'));
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  if (!lines.length) return { entries: [], totalRawRows: 0 };

  const headerFields = parseCsvLine(lines[0]);
  const titleIdx = headerFields.findIndex(
    (h) => h.trim().toLowerCase() === 'title',
  );
  const dateIdx = headerFields.findIndex(
    (h) => h.trim().toLowerCase() === 'date',
  );

  if (titleIdx === -1) {
    throw new Error('CSV is missing the required "Title" column header');
  }

  const dataLines = lines.slice(1);
  const dateValues =
    dateIdx >= 0
      ? dataLines.map((l) => parseCsvLine(l)[dateIdx] ?? '').filter(Boolean)
      : [];
  const format = detectDateFormat(dateValues);

  const raw: ParsedNetflixEntry[] = [];
  for (const line of dataLines) {
    const fields = parseCsvLine(line);
    const rawTitle = (fields[titleIdx] ?? '').trim();
    if (!rawTitle) continue;

    const parsedTitle = stripTvPatterns(rawTitle);
    const dateStr = dateIdx >= 0 ? (fields[dateIdx] ?? '').trim() : '';
    const watchedAt = dateStr ? parseDate(dateStr, format) : null;

    raw.push({ rawTitle, parsedTitle, watchedAt });
  }

  const totalRawRows = raw.length;

  const dedupMap = new Map<string, ParsedNetflixEntry>();
  for (const entry of raw) {
    const key = entry.parsedTitle.toLowerCase();
    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, entry);
    } else if (
      entry.watchedAt &&
      (!existing.watchedAt || entry.watchedAt > existing.watchedAt)
    ) {
      dedupMap.set(key, { ...entry, parsedTitle: existing.parsedTitle });
    }
  }

  return { entries: Array.from(dedupMap.values()), totalRawRows };
}
