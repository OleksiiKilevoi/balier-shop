import { describe, expect, it, vi } from 'vitest';
import type { Order, OrderItem } from '../db/schema';
import { createEmailNotifier, formatOrderEmail, formatReviewRequestEmail } from './email';

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNumber: 'B260804-TEST1',
    status: 'confirmed',
    customerName: 'Тест Тестенко',
    customerPhone: '+380501234567',
    customerEmail: 'test@example.com',
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

function fakeEmailBinding() {
  const send = vi.fn(async (_message: EmailMessageBuilder) => ({ messageId: 'msg-1' }));
  return { send } as unknown as SendEmail & { send: typeof send };
}

// `formatPrice` (src/lib/money.ts) separates thousands and joins the currency
// symbol with U+00A0 (NBSP), not a plain space — assertions below build the
// expected price strings the same way rather than typing a literal space,
// which would silently never match.
const NBSP = ' ';
const price1950 = `1${NBSP}950${NBSP}₴`;

describe('formatOrderEmail', () => {
  it('includes the order number, items, total, payment and delivery destination', () => {
    const { subject, text, html } = formatOrderEmail({ order: order(), items: [item()] });

    expect(subject).toContain('B260804-TEST1');
    expect(text).toContain(`Гаманець (GM-01) — 1 × ${price1950}`);
    expect(text).toContain(`Разом: ${price1950}`);
    expect(text).toContain('Готівкою при отриманні');
    expect(text).toContain('Відділення Нової Пошти — м. Київ, Відділення №5');
    expect(html).toContain('Гаманець (GM-01)');
  });

  it('escapes HTML in customer-supplied fields', () => {
    const { html } = formatOrderEmail({
      order: order({ customerName: '<b>Тест</b>', comment: '<script>alert(1)</script>' }),
      items: [item()],
    });

    expect(html).not.toContain('<b>Тест</b>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;b&gt;Тест&lt;/b&gt;');
  });

  it('shows the street address for courier delivery', () => {
    const { text } = formatOrderEmail({
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

describe('createEmailNotifier', () => {
  it('sends orderCreated for a cash-on-delivery order', async () => {
    const binding = fakeEmailBinding();
    const notifier = createEmailNotifier(binding, 'noreply@balier.ua');

    await notifier.orderCreated({ order: order({ paymentMethod: 'cod' }), items: [item()] });

    expect(binding.send).toHaveBeenCalledTimes(1);
    const [message] = binding.send.mock.calls[0]!;
    expect(message).toMatchObject({
      to: 'test@example.com',
      from: { name: 'Balier', email: 'noreply@balier.ua' },
    });
  });

  it('does not send orderCreated for a card order — that waits for orderPaid', async () => {
    const binding = fakeEmailBinding();
    const notifier = createEmailNotifier(binding, 'noreply@balier.ua');

    await notifier.orderCreated({ order: order({ paymentMethod: 'card' }), items: [item()] });

    expect(binding.send).not.toHaveBeenCalled();
  });

  it('sends orderPaid for a card order', async () => {
    const binding = fakeEmailBinding();
    const notifier = createEmailNotifier(binding, 'noreply@balier.ua');

    await notifier.orderPaid({
      order: order({ status: 'paid', paymentMethod: 'card' }),
      items: [item()],
    });

    expect(binding.send).toHaveBeenCalledTimes(1);
  });

  it('skips sending when the order has no customer email', async () => {
    const binding = fakeEmailBinding();
    const notifier = createEmailNotifier(binding, 'noreply@balier.ua');

    await notifier.orderCreated({
      order: order({ paymentMethod: 'cod', customerEmail: null }),
      items: [item()],
    });
    await notifier.orderPaid({ order: order({ customerEmail: null }), items: [item()] });

    expect(binding.send).not.toHaveBeenCalled();
  });

  it('never emails the customer about a payment for a cancelled order', async () => {
    const binding = fakeEmailBinding();
    const notifier = createEmailNotifier(binding, 'noreply@balier.ua');

    await notifier.paymentAfterCancellation({
      order: order({ status: 'cancelled', paymentMethod: 'card' }),
      items: [item()],
    });

    expect(binding.send).not.toHaveBeenCalled();
  });

  it('never throws when the send() call rejects', async () => {
    const binding = {
      send: vi.fn(async () => {
        throw new Error('E_SENDER_NOT_VERIFIED');
      }),
    } as unknown as SendEmail;
    const notifier = createEmailNotifier(binding, 'noreply@balier.ua');

    await expect(
      notifier.orderCreated({ order: order({ paymentMethod: 'cod' }), items: [item()] }),
    ).resolves.toBeUndefined();
  });
});

describe('formatReviewRequestEmail', () => {
  it('links the review page and escapes the name', () => {
    const mail = formatReviewRequestEmail({
      to: 'a@b.ua',
      customerName: 'Олена <b>',
      reviewUrl: 'https://balier.com.ua/review/abc',
    });
    expect(mail.text).toContain('https://balier.com.ua/review/abc');
    expect(mail.html).toContain('href="https://balier.com.ua/review/abc"');
    expect(mail.html).toContain('Олена &lt;b&gt;');
  });
});
