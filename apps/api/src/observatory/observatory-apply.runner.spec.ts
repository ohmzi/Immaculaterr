import { NotFoundException } from '@nestjs/common';
import {
  ObservatoryApplyRunner,
  serializeApplyRecord,
} from './observatory-apply.runner';

// A deferred promise, so a test can hold an apply in the running state for as
// long as it needs and settle it on demand.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Let the runner's detached async work reach its next await.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ObservatoryApplyRunner', () => {
  let runner: ObservatoryApplyRunner;

  beforeEach(() => {
    runner = new ObservatoryApplyRunner();
  });

  const key = (
    overrides: Partial<{ userId: string; mediaType: string }> = {},
  ) =>
    runner.buildKey({
      userId: overrides.userId ?? 'user-1',
      scope: 'immaculate',
      mediaType: overrides.mediaType ?? 'movie',
      librarySectionKey: '1',
    });

  it('returns immediately with a running handle instead of awaiting the work', async () => {
    const gate = deferred<{ ok: true }>();
    const record = runner.start({
      userId: 'user-1',
      key: key(),
      run: () => gate.promise,
    });

    expect(record.status).toBe('running');
    expect(record.finishedAt).toBeNull();
    expect(typeof record.id).toBe('string');

    gate.resolve({ ok: true });
    await flush();
  });

  it('records the result once the work succeeds', async () => {
    const record = runner.start({
      userId: 'user-1',
      key: key(),
      run: () => Promise.resolve({ ok: true, plex: { added: 3 } }),
    });
    await flush();

    const polled = runner.get({ userId: 'user-1', id: record.id });
    expect(polled.status).toBe('succeeded');
    expect(polled.result).toEqual({ ok: true, plex: { added: 3 } });
    expect(polled.error).toBeNull();
    expect(typeof polled.finishedAt).toBe('number');
  });

  it('captures a failure as a message rather than an unhandled rejection', async () => {
    const record = runner.start({
      userId: 'user-1',
      key: key(),
      run: () => Promise.reject(new Error('Plex token is not set')),
    });
    await flush();

    const polled = runner.get({ userId: 'user-1', id: record.id });
    expect(polled.status).toBe('failed');
    expect(polled.error).toBe('Plex token is not set');
  });

  it('falls back to a generic message when the failure carries none', async () => {
    const record = runner.start({
      userId: 'user-1',
      key: key(),
      run: () => Promise.reject(new Error('   ')),
    });
    await flush();

    expect(runner.get({ userId: 'user-1', id: record.id }).error).toBe(
      'Apply failed',
    );
  });

  it('coalesces a second apply for the same target onto the running one', async () => {
    const gate = deferred<{ ok: true }>();
    const run = jest.fn(() => gate.promise);

    const first = runner.start({ userId: 'user-1', key: key(), run });
    const second = runner.start({ userId: 'user-1', key: key(), run });

    expect(second.id).toBe(first.id);
    expect(run).toHaveBeenCalledTimes(1);

    gate.resolve({ ok: true });
    await flush();
  });

  it('starts a fresh apply once the previous one for that key has settled', async () => {
    const first = runner.start({
      userId: 'user-1',
      key: key(),
      run: () => Promise.resolve({ ok: true }),
    });
    await flush();

    const second = runner.start({
      userId: 'user-1',
      key: key(),
      run: () => Promise.resolve({ ok: true }),
    });
    await flush();

    expect(second.id).not.toBe(first.id);
  });

  it('keeps different libraries, media types and users on separate keys', async () => {
    const gate = deferred<{ ok: true }>();
    const run = () => gate.promise;

    const movie = runner.start({ userId: 'user-1', key: key(), run });
    const tv = runner.start({
      userId: 'user-1',
      key: key({ mediaType: 'tv' }),
      run,
    });
    const otherUser = runner.start({
      userId: 'user-2',
      key: key({ userId: 'user-2' }),
      run,
    });

    expect(new Set([movie.id, tv.id, otherUser.id]).size).toBe(3);

    gate.resolve({ ok: true });
    await flush();
  });

  it('hides another user’s apply behind the same 404 as an unknown id', async () => {
    const record = runner.start({
      userId: 'user-1',
      key: key(),
      run: () => Promise.resolve({ ok: true }),
    });
    await flush();

    expect(() => runner.get({ userId: 'user-2', id: record.id })).toThrow(
      NotFoundException,
    );
    expect(() => runner.get({ userId: 'user-1', id: 'nope' })).toThrow(
      NotFoundException,
    );
  });

  it('serializes without leaking the user id or the coalescing key', async () => {
    const record = runner.start({
      userId: 'user-1',
      key: key(),
      run: () => Promise.resolve({ ok: true }),
    });
    await flush();

    const body = serializeApplyRecord(
      runner.get({ userId: 'user-1', id: record.id }),
    );
    expect(Object.keys(body).sort()).toEqual([
      'applyId',
      'error',
      'finishedAt',
      'result',
      'startedAt',
      'status',
    ]);
    expect(body.applyId).toBe(record.id);
    expect(body.status).toBe('succeeded');
    expect(body.result).toEqual({ ok: true });
    expect(body.error).toBeNull();
    expect(typeof body.startedAt).toBe('string');
    expect(typeof body.finishedAt).toBe('string');
    expect(JSON.stringify(body)).not.toContain('user-1');
  });

  it('reports a still-running apply as running with no finish time', () => {
    const gate = deferred<{ ok: true }>();
    const record = runner.start({
      userId: 'user-1',
      key: key(),
      run: () => gate.promise,
    });

    const body = serializeApplyRecord(
      runner.get({ userId: 'user-1', id: record.id }),
    );
    expect(body.status).toBe('running');
    expect(body.finishedAt).toBeNull();

    gate.resolve({ ok: true });
  });
});
