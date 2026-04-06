import {
  parseNetflixCsv,
  detectDateFormat,
  type DateFormat,
} from './netflix-csv.parser';

function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf-8');
}

function bomCsv(lines: string[]): Buffer {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([bom, csv(lines)]);
}

describe('netflix-csv.parser', () => {
  describe('parseNetflixCsv', () => {
    it('parses a basic Netflix CSV', () => {
      const { entries, totalRawRows } = parseNetflixCsv(
        csv(['Title,Date', 'Inception,3/21/26', 'The Matrix,2/14/26']),
      );
      expect(entries).toHaveLength(2);
      expect(totalRawRows).toBe(2);
      expect(entries[0].parsedTitle).toBe('Inception');
      expect(entries[1].parsedTitle).toBe('The Matrix');
    });

    it('strips known TV patterns', () => {
      const { entries, totalRawRows } = parseNetflixCsv(
        csv([
          'Title,Date',
          'The Winning Try: Limited Series: Episode 12,2/14/26',
          'The Winning Try: Limited Series: Episode 11,2/14/26',
        ]),
      );
      expect(entries).toHaveLength(1);
      expect(totalRawRows).toBe(2);
      expect(entries[0].parsedTitle).toBe('The Winning Try');
    });

    it('preserves movie colons', () => {
      const { entries } = parseNetflixCsv(
        csv(['Title,Date', 'Spider-Man: No Way Home,1/15/26']),
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].parsedTitle).toBe('Spider-Man: No Way Home');
    });

    it('preserves unknown episode patterns for TMDB fallback', () => {
      const { entries } = parseNetflixCsv(
        csv(['Title,Date', "Unsuspicious: Jorginho's iron will,2/8/26"]),
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].parsedTitle).toBe("Unsuspicious: Jorginho's iron will");
    });

    it('deduplicates by parsedTitle (case-insensitive)', () => {
      const { entries, totalRawRows } = parseNetflixCsv(
        csv([
          'Title,Date',
          'Breaking Bad: Season 5: Episode 16,3/1/26',
          'Breaking Bad: Season 5: Episode 15,2/28/26',
          'Breaking Bad: Season 5: Episode 14,2/27/26',
          'Breaking Bad: Season 5: Episode 13,2/26/26',
          'Breaking Bad: Season 5: Episode 12,2/25/26',
        ]),
      );
      expect(entries).toHaveLength(1);
      expect(totalRawRows).toBe(5);
      expect(entries[0].parsedTitle).toBe('Breaking Bad');
      expect(entries[0].watchedAt).toEqual(new Date(2026, 2, 1));
    });

    it('strips UTF-8 BOM', () => {
      const { entries } = parseNetflixCsv(
        bomCsv(['Title,Date', 'Test Movie,1/1/26']),
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].parsedTitle).toBe('Test Movie');
    });

    it('handles empty CSV', () => {
      const { entries, totalRawRows } = parseNetflixCsv(csv(['Title,Date']));
      expect(entries).toHaveLength(0);
      expect(totalRawRows).toBe(0);
    });

    it('throws on missing Title header', () => {
      expect(() => parseNetflixCsv(csv(['Name,Date', 'Test,1/1/26']))).toThrow(
        'CSV is missing the required "Title" column header',
      );
    });

    it('skips empty rows', () => {
      const { entries } = parseNetflixCsv(
        csv(['Title,Date', '', 'Inception,3/21/26', '', '']),
      );
      expect(entries).toHaveLength(1);
    });

    it('handles rows with missing date column gracefully', () => {
      const { entries } = parseNetflixCsv(csv(['Title', 'Inception']));
      expect(entries).toHaveLength(1);
      expect(entries[0].watchedAt).toBeNull();
    });

    it('rejects malformed non-string CSV lines without iterating their length', () => {
      const maliciousLine = {
        length: Number.MAX_SAFE_INTEGER,
        trim: () => 'Title,Date',
      };
      const fakeText = {
        charCodeAt: () => Number.NaN,
        slice: () => '',
        split: () => [maliciousLine],
      };
      const fakeBuffer = {
        toString: () => fakeText,
      };

      expect(() => parseNetflixCsv(fakeBuffer as unknown as Buffer)).toThrow(
        'CSV is missing the required "Title" column header',
      );
    });

    it('handles 2-digit years as 2000+', () => {
      const { entries } = parseNetflixCsv(csv(['Title,Date', 'Movie,1/15/23']));
      expect(entries[0].watchedAt?.getFullYear()).toBe(2023);
    });

    it('strips Season patterns', () => {
      const { entries } = parseNetflixCsv(
        csv(['Title,Date', 'Stranger Things: Season 4: Chapter 1,7/1/22']),
      );
      expect(entries[0].parsedTitle).toBe('Stranger Things');
    });

    it('strips Part patterns', () => {
      const { entries } = parseNetflixCsv(
        csv(['Title,Date', 'Money Heist: Part 5: Episode 1,12/3/21']),
      );
      expect(entries[0].parsedTitle).toBe('Money Heist');
    });

    it('strips Volume patterns', () => {
      const { entries } = parseNetflixCsv(
        csv(['Title,Date', '"Love, Death & Robots: Volume 3: Jibaro",5/20/22']),
      );
      expect(entries[0].parsedTitle).toBe('Love, Death & Robots');
    });
  });

  describe('detectDateFormat', () => {
    it('detects M/D/Y when ambiguous (all values <= 12)', () => {
      const fmt: DateFormat = detectDateFormat(['1/2/26', '3/4/26']);
      expect(fmt).toBe('mdy');
    });

    it('detects D/M/Y when first part > 12', () => {
      const fmt: DateFormat = detectDateFormat(['15/2/26', '3/4/26']);
      expect(fmt).toBe('dmy');
    });

    it('detects M/D/Y when second part > 12', () => {
      const fmt: DateFormat = detectDateFormat(['2/15/26', '3/4/26']);
      expect(fmt).toBe('mdy');
    });
  });
});
