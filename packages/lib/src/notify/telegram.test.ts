import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Order, OrderItem } from '../db/schema';
import { createTelegramNotifier, formatOrderMessage } from './telegram';

afterEach(() => {
  vi.unstubAllGlobals();
});

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNumber: 'B260804-TEST1',
    status: 'confirmed',
    customerName: 'Тест Тестенко',
    customerPhone: '+380501234567',
    customerEmail: null,
    deliveryMethod: 'np_warehouse',
    npSettlementRef: 'ref-1',
    npSettlementName: 'м. Київ',
    npWarehouseRef: 'wh-1',
    npWarehouseName: 'Відділення №5',
    npAddress: null,
    npTtn: null,
    npTtnRef: null,
    npTtnCreatedAt: null,
    npStatusCode: null,
    npStatusText: null,
    npStatusAt: null,
    npMoneyTransferAt: null,
    npScanSheetRef: null,
    paymentMethod: 'cod',
    itemsTotal: 195000,
    promoCode: null,
  discountTotal: 0,
  deliveryTotal: 0,
    total: 195000,
    comment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    paidAt: null,
    cancelledAt: null,
    statusBeforeExit: null,
    reviewToken: '00000000-0000-4000-8000-000000000000',
    reviewRequestedAt: null,
    ...overrides,
  };
}

function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    orderId: 'order-1',
    variantId: 'variant-1',
    productSlug: 'gaman',
    productTitle: 'Гаманець',
    variantName: null,
    sku: 'GM-01',
    unitPrice: 195000,
    quantity: 1,
    lineTotal: 195000,
    ...overrides,
  };
}

describe('formatOrderMessage', () => {
  it('includes the order number, items, total, payment and delivery destination', () => {
    const text = formatOrderMessage('Нове замовлення', { order: order(), items: [item()] });

    expect(text).toContain('B260804-TEST1');
    expect(text).toContain('Гаманець (GM-01) — 1 × 1 950 ₴');
    expect(text).toContain('Разом: 1 950 ₴');
    expect(text).toContain('Готівкою при отриманні');
    expect(text).toContain('Відділення Нової Пошти — м. Київ, Відділення №5');
    expect(text).toContain('Тест Тестенко, +380501234567');
  });

  it('renders a variant colour and a comment when present', () => {
    const text = formatOrderMessage('Нове замовлення', {
      order: order({ comment: 'Зателефонуйте ввечері' }),
      items: [item({ variantName: 'чорний' })],
    });

    expect(text).toContain('Гаманець, чорний (GM-01)');
    expect(text).toContain('Коментар: Зателефонуйте ввечері');
  });

  it('shows the street address for courier delivery', () => {
    const text = formatOrderMessage('Нове замовлення', {
      order: order({
        deliveryMethod: 'np_courier',
        npWarehouseRef: null,
        npWarehouseName: null,
        npAddress: 'вул. Хрещатик, 1',
      }),
      items: [item()],
    });

    expect(text).toContain('Кур’єром — м. Київ, вул. Хрещатик, 1');
  });
});

describe('createTelegramNotifier', () => {
  it('sends orderPaid to the manager chat with the paid heading', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const notifier = createTelegramNotifier('bot-token', 'chat-id');
    await notifier.orderPaid({
      order: order({ status: 'paid', paymentMethod: 'card' }),
      items: [item()],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.telegram.org/botbot-token/sendMessage');
    const sent = JSON.parse(init!.body as string) as { chat_id: string; text: string };
    expect(sent.chat_id).toBe('chat-id');
    expect(sent.text.startsWith('Оплачено')).toBe(true);
    expect(sent.text).toContain('B260804-TEST1');
    expect(sent.text).toContain('Карткою онлайн');
  });

  it('sends the paid-after-cancellation alert with the refund heading', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const notifier = createTelegramNotifier('bot-token', 'chat-id');
    await notifier.paymentAfterCancellation({
      order: order({ status: 'cancelled', paymentMethod: 'card' }),
      items: [item()],
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const sent = JSON.parse(init!.body as string) as { text: string };
    expect(sent.text).toContain('СКАСОВАНИМ');
    expect(sent.text).toContain('повернення коштів');
    expect(sent.text).toContain('B260804-TEST1');
  });

  it('never throws when Telegram is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const notifier = createTelegramNotifier('bot-token', 'chat-id');
    await expect(
      notifier.orderPaid({ order: order(), items: [item()] }),
    ).resolves.toBeUndefined();
  });
});
