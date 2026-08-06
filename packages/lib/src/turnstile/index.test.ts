import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTurnstileCaptcha } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verify', () => {
  it('accepts a token siteverify reports success for', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const captcha = createTurnstileCaptcha('test-secret');
    await expect(captcha.verify('a-real-token')).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const sentBody = new URLSearchParams(init!.body as string);
    expect(sentBody.get('secret')).toBe('test-secret');
    expect(sentBody.get('response')).toBe('a-real-token');
  });

  it('passes remoteIp through when given', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const captcha = createTurnstileCaptcha('test-secret');
    await captcha.verify('a-real-token', '203.0.113.1');

    const [, init] = fetchMock.mock.calls[0]!;
    const sentBody = new URLSearchParams(init!.body as string);
    expect(sentBody.get('remoteip')).toBe('203.0.113.1');
  });

  it('rejects a token siteverify reports failure for', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 })),
    );

    const captcha = createTurnstileCaptcha('test-secret');
    await expect(captcha.verify('bad-token')).resolves.toBe(false);
  });

  it('rejects an empty token without calling siteverify at all', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const captcha = createTurnstileCaptcha('test-secret');
    await expect(captcha.verify('')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects instead of throwing when siteverify is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const captcha = createTurnstileCaptcha('test-secret');
    await expect(captcha.verify('a-real-token')).resolves.toBe(false);
  });

  it('rejects instead of throwing when siteverify returns a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));

    const captcha = createTurnstileCaptcha('test-secret');
    await expect(captcha.verify('a-real-token')).resolves.toBe(false);
  });
});
