import { generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMonobankPayment } from './index';

/**
 * Webhook signature verification is the other place `docs/CONVENTIONS.md`
 * names as "a bug costs money" (alongside order-total calculation). These
 * tests generate a real ECDSA P-256 keypair with `node:crypto` and sign
 * fixtures independently of `derToRaw` (Node's `dsaEncoding` option produces
 * both DER and raw-P1363 signatures directly), so the test doesn't just
 * check the implementation against itself.
 */

/**
 * Mirrors the real API: `key` is base64 of a **PEM document** (confirmed live —
 * the decoded bytes start with `-----BEGIN PUBLIC KEY-----`). The earlier
 * version of this helper returned base64 of the DER, which made the suite agree
 * with a broken implementation and let every real webhook 403 in production.
 */
function stubPubkeyFetch(publicKey: KeyObject, format: 'pem' | 'der' = 'pem'): void {
  const exported = publicKey.export({ type: 'spki', format }) as Buffer | string;
  const key = Buffer.from(exported).toString('base64');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ key }), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyWebhook', () => {
  it('accepts a valid DER-encoded ECDSA signature over the raw body', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    stubPubkeyFetch(publicKey);

    const body = JSON.stringify({ invoiceId: 'abc', status: 'success' });
    const signature = nodeSign('sha256', Buffer.from(body), {
      key: privateKey,
      dsaEncoding: 'der',
    }).toString('base64');

    const payment = createMonobankPayment('test-token');
    await expect(payment.verifyWebhook(body, signature)).resolves.toBe(true);
  });

  it('also accepts a pubkey delivered as bare DER rather than PEM', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    stubPubkeyFetch(publicKey, 'der');

    const body = JSON.stringify({ invoiceId: 'abc', status: 'success' });
    const signature = nodeSign('sha256', Buffer.from(body), {
      key: privateKey,
      dsaEncoding: 'der',
    }).toString('base64');

    const payment = createMonobankPayment('test-token');
    await expect(payment.verifyWebhook(body, signature)).resolves.toBe(true);
  });

  it('also accepts an already-raw 64-byte r‖s signature', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    stubPubkeyFetch(publicKey);

    const body = JSON.stringify({ invoiceId: 'abc' });
    const signature = nodeSign('sha256', Buffer.from(body), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64');

    const payment = createMonobankPayment('test-token');
    await expect(payment.verifyWebhook(body, signature)).resolves.toBe(true);
  });

  it('rejects a signature over a different body — a tampered payload must not verify', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    stubPubkeyFetch(publicKey);

    const body = JSON.stringify({ invoiceId: 'abc', status: 'success' });
    const signature = nodeSign('sha256', Buffer.from(body), {
      key: privateKey,
      dsaEncoding: 'der',
    }).toString('base64');

    const payment = createMonobankPayment('test-token');
    await expect(payment.verifyWebhook(`${body}x`, signature)).resolves.toBe(false);
  });

  it('rejects a signature made with the wrong key', async () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const { privateKey: otherPrivateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    stubPubkeyFetch(publicKey);

    const body = JSON.stringify({ invoiceId: 'abc' });
    const signature = nodeSign('sha256', Buffer.from(body), {
      key: otherPrivateKey,
      dsaEncoding: 'der',
    }).toString('base64');

    const payment = createMonobankPayment('test-token');
    await expect(payment.verifyWebhook(body, signature)).resolves.toBe(false);
  });

  it('rejects when there is no signature header at all', async () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    stubPubkeyFetch(publicKey);

    const payment = createMonobankPayment('test-token');
    await expect(payment.verifyWebhook('{}', null)).resolves.toBe(false);
  });

  it('rejects garbage instead of throwing', async () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    stubPubkeyFetch(publicKey);

    const payment = createMonobankPayment('test-token');
    await expect(payment.verifyWebhook('{}', 'not-base64-signature!!')).resolves.toBe(false);
  });
});

describe('removeInvoice', () => {
  it('POSTs the invoice id to invoice/remove under the merchant token', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const payment = createMonobankPayment('test-token');
    await payment.removeInvoice('inv-123');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.monobank.ua/api/merchant/invoice/remove');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['X-Token']).toBe('test-token');
    expect(JSON.parse(init?.body as string)).toEqual({ invoiceId: 'inv-123' });
  });

  it('throws on a non-2xx response — removal is best-effort and callers log it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('already finished', { status: 400 })),
    );

    const payment = createMonobankPayment('test-token');
    await expect(payment.removeInvoice('inv-123')).rejects.toThrow('invoice/remove failed: 400');
  });
});
