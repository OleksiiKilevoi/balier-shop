import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, peekRateLimit, recordRateLimitHit } from './index';

/** Minimal in-memory stand-in for the one KV method this module calls. */
function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  } as unknown as KVNamespace;
}

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('allows requests under the limit', async () => {
    const kv = fakeKv();
    const first = await checkRateLimit(kv, 'ip:1', 3, 60);
    const second = await checkRateLimit(kv, 'ip:1', 3, 60);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it('blocks the request that crosses the limit', async () => {
    const kv = fakeKv();
    await checkRateLimit(kv, 'ip:1', 2, 60);
    await checkRateLimit(kv, 'ip:1', 2, 60);
    const third = await checkRateLimit(kv, 'ip:1', 2, 60);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps separate counts per key', async () => {
    const kv = fakeKv();
    await checkRateLimit(kv, 'ip:1', 1, 60);
    const other = await checkRateLimit(kv, 'ip:2', 1, 60);
    expect(other.allowed).toBe(true);
  });

  it('resets once the window rolls over', async () => {
    vi.setSystemTime(0);
    const kv = fakeKv();
    await checkRateLimit(kv, 'ip:1', 1, 60);
    const stillBlocked = await checkRateLimit(kv, 'ip:1', 1, 60);
    expect(stillBlocked.allowed).toBe(false);

    vi.setSystemTime(60_000);
    const nextWindow = await checkRateLimit(kv, 'ip:1', 1, 60);
    expect(nextWindow.allowed).toBe(true);
  });
});

/**
 * The split the admin login form needs: it must be able to ask "would this be
 * allowed?" without spending anything, so that only a *wrong* password costs
 * budget and an operator can never lock themselves out by signing in.
 */
describe('peekRateLimit / recordRateLimitHit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('peeking never spends budget, however often it is asked', async () => {
    const kv = fakeKv();
    for (let i = 0; i < 20; i++) {
      expect((await peekRateLimit(kv, 'ip:1', 3, 60)).allowed).toBe(true);
    }
  });

  it('only recorded hits count toward the limit', async () => {
    const kv = fakeKv();
    await recordRateLimitHit(kv, 'ip:1', 60);
    await recordRateLimitHit(kv, 'ip:1', 60);
    expect((await peekRateLimit(kv, 'ip:1', 3, 60)).allowed).toBe(true);

    await recordRateLimitHit(kv, 'ip:1', 60);
    expect((await peekRateLimit(kv, 'ip:1', 3, 60)).allowed).toBe(false);
  });

  it('agrees with checkRateLimit, which is now built from the two', async () => {
    // Explicit, because `useFakeTimers()` in `beforeEach` does not rewind a
    // clock that is already faked — without this the test inherits whatever
    // time the previous one left behind, and the window below never rolls.
    vi.setSystemTime(0);
    const kv = fakeKv();
    await checkRateLimit(kv, 'ip:1', 2, 60);
    await checkRateLimit(kv, 'ip:1', 2, 60);

    expect((await peekRateLimit(kv, 'ip:1', 2, 60)).allowed).toBe(false);
    // A blocked `checkRateLimit` must not spend anything either, or a client
    // that keeps knocking would extend its own lockout past the window.
    await checkRateLimit(kv, 'ip:1', 2, 60);
    vi.setSystemTime(60_000);
    expect((await peekRateLimit(kv, 'ip:1', 2, 60)).allowed).toBe(true);
  });

  it('reports the seconds left in the window', async () => {
    vi.setSystemTime(30_000);
    const kv = fakeKv();
    expect((await peekRateLimit(kv, 'ip:1', 1, 60)).retryAfterSeconds).toBe(30);
  });
});
