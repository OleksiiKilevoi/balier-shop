import { describe, expect, it } from 'vitest';
import type { Order, OrderItem } from '~/lib/db/schema';
import { formatOrderMessage } from './telegram';

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
    paymentMethod: 'cod',
    itemsTotal: 195000,
    deliveryTotal: 0,
    total: 195000,
    comment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    paidAt: null,
    cancelledAt: null,
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
