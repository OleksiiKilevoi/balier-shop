import type { DeliveryMethod, Order, PaymentMethod } from '~/lib/db/schema';

/**
 * Shared by the Telegram (`./telegram`) and email (`./email`) order-notification
 * adapters, and by the admin order screens — one order reads the same way
 * wherever it is shown.
 */

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  np_warehouse: 'Відділення Нової Пошти',
  np_postomat: 'Поштомат',
  np_courier: 'Кур’єром',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: 'Карткою онлайн',
  cod: 'Готівкою при отриманні',
};

export function deliveryDestination(order: Order): string {
  if (order.deliveryMethod === 'np_courier') {
    return [order.npSettlementName, order.npAddress].filter(Boolean).join(', ');
  }
  return [order.npSettlementName, order.npWarehouseName].filter(Boolean).join(', ');
}
