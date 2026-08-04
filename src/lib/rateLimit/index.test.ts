import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from './index';

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
