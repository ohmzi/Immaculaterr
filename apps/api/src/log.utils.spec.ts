import { redactSecretsFromText, truncateErrorMessage } from './log.utils';

describe('redactSecretsFromText', () => {
  it('redacts api-key style query values embedded in error text', () => {
    const input =
      'TMDB request failed: HTTP 401 for /3/discover/movie?api_key=abcd1234&page=1';
    const out = redactSecretsFromText(input);
    expect(out).toContain('api_key=REDACTED');
    expect(out).not.toContain('abcd1234');
    expect(out).toContain('page=1');
  });

  it('redacts Plex token parameters', () => {
    const out = redactSecretsFromText(
      'GET https://plex/library/sections?X-Plex-Token=SeCrEtToKeN failed',
    );
    expect(out).toContain('X-Plex-Token=REDACTED');
    expect(out).not.toContain('SeCrEtToKeN');
  });

  it('redacts bare 32-hex API keys anywhere in the text', () => {
    const key = '0123456789abcdef0123456789abcdef';
    const out = redactSecretsFromText(`Radarr rejected key ${key} (401)`);
    expect(out).not.toContain(key);
    expect(out).toContain('REDACTED');
  });

  it('leaves ordinary text and short hashes untouched', () => {
    const input = 'HTTP 502 from api.themoviedb.org (commit deadbeef)';
    expect(redactSecretsFromText(input)).toBe(input);
  });
});

describe('truncateErrorMessage', () => {
  it('redacts secrets before truncating', () => {
    const err = new Error(
      'fetch failed: /3/discover/movie?api_key=ffffffffffffffffffffffffffffffff',
    );
    const out = truncateErrorMessage(err);
    expect(out).not.toContain('ffffffffffffffffffffffffffffffff');
    expect(out).toContain('REDACTED');
  });
});
