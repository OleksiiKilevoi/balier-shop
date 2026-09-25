import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMonoPartsPayment, mapPartsState, partsProducts, signBody } from './index';

const config = { baseUrl: 'https://u2-demo-ext.mono.st4g3.com', storeId: 'test_store_with_confirm', secret: 'secret_98765432--123-123' };

afterEach(() => vi.unstubAllGlobals());

describe('signBody / verifyWebhook', () => {
  it('matches an independent HMAC-SHA256 and rejects anything else', async () => {
    const body = JSON.stringify({ order_id: 'x', state: 'IN_PROCESS', order_sub_state: 'WAITING_FOR_STORE_CONFIRM' });
    const expected = createHmac('sha256', config.secret).update(body).digest('base64');
    expect(await signBody(body, config.secret)).toBe(expected);

    const port = createMonoPartsPayment(config);
    expect(await port.verifyWebhook(body, expected)).toBe(true);
    expect(await port.verifyWebhook(body + ' ', expected)).toBe(false);
    expect(await port.verifyWebhook(body, null)).toBe(false);
  });
});

describe('mapPartsState', () => {
  it('reads client approval as paid, every FAIL as failure, the rest as waiting', () => {
    expect(mapPartsState('IN_PROCESS', 'WAITING_FOR_CLIENT')).toBe('processing');
    expect(mapPartsState('IN_PROCESS', 'WAITING_FOR_STORE_CONFIRM')).toBe('success');
    expect(mapPartsState('SUCCESS', 'ACTIVE')).toBe('success');
    expect(mapPartsState('SUCCESS', 'RETURNED')).toBe('reversed');
    expect(mapPartsState('FAIL', 'CLIENT_PUSH_TIMEOUT')).toBe('failure');
  });
});

describe('partsProducts', () => {
  const base = { orderNumber: 'B1', redirectUrl: '', webhookUrl: '', validitySeconds: 0 };
  it('lists items in hryvnias when they add up to the total', () => {
    expect(
      partsProducts({ ...base, amount: 425_000, items: [{ productTitle: 'Сумка', unitPrice: 425_000, quantity: 1, sku: 'S' }] }),
    ).toEqual([{ name: 'Сумка', count: 1, sum: 4250 }]);
  });
  it('falls back to one line when a discount breaks the sum', () => {
    expect(partsProducts({ ...base, amount: 382_500, items: [] })).toEqual([
      { name: 'Замовлення B1', count: 1, sum: 3825 },
    ]);
  });
});

describe('createInvoice', () => {
  it('posts a signed application and returns the order id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ order_id: 'abc' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const invoice = await createMonoPartsPayment(config).createInvoice({
      orderNumber: 'B2', amount: 200_000, items: [], customerPhone: '+380501112231',
      redirectUrl: 'https://s/ok', webhookUrl: 'https://s/wh', validitySeconds: 900,
    });
    expect(invoice).toEqual({ invoiceId: 'abc', pageUrl: 'https://s/ok' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://u2-demo-ext.mono.st4g3.com/api/order/create');
    const headers = init.headers as Record<string, string>;
    expect(headers['store-id']).toBe('test_store_with_confirm');
    expect(headers.signature).toBe(createHmac('sha256', config.secret).update(String(init.body)).digest('base64'));
    expect(JSON.parse(String(init.body))).toMatchObject({ store_order_id: 'B2', total_sum: 2000, client_phone: '+380501112231' });
  });
});
