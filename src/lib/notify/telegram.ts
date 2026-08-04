import type { DeliveryMethod, Order, PaymentMethod } from '~/lib/db/schema';
import { formatPrice } from '~/lib/money';
import type { NotifierPort, OrderNotification } from '~/lib/ports';

/**
 * Telegram Bot API adapter for `NotifierPort`. Sends into the manager chat the
 * bot was added to (`TELEGRAM_CHAT_ID`), distinct from `~/lib/telegram`'s
 * customer-facing deep link.
 *
 * Best-effort by the port's own contract: `send` never throws, so a Telegram
 * outage never fails order placement (`docs/OVERVIEW.md`, "Turnstile,
 * Telegram, email").
 */

const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  np_warehouse: 'Відділення Нової Пошти',
  np_postomat: 'Поштомат',
  np_courier: 'Кур’єром',
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: 'Карткою онлайн',
  cod: 'Готівкою при отриманні',
};

function deliveryDestination(order: Order): string {
  if (order.deliveryMethod === 'np_courier') {
    return [order.npSettlementName, order.npAddress].filter(Boolean).join(', ');
  }
  return [order.npSettlementName, order.npWarehouseName].filter(Boolean).join(', ');
}

export function formatOrderMessage(heading: string, notification: OrderNotification): string {
  const { order, items } = notification;

  const itemLines = items.map((item) => {
    const name = item.variantName ? `${item.productTitle}, ${item.variantName}` : item.productTitle;
    return `• ${name} (${item.sku}) — ${item.quantity} × ${formatPrice(item.unitPrice)}`;
  });

  const lines = [
    heading,
    `Замовлення ${order.orderNumber}`,
    '',
    ...itemLines,
    '',
    `Разом: ${formatPrice(order.total)}`,
    `Оплата: ${PAYMENT_METHOD_LABELS[order.paymentMethod]}`,
    `Доставка: ${DELIVERY_METHOD_LABELS[order.deliveryMethod]} — ${deliveryDestination(order)}`,
    '',
    `${order.customerName}, ${order.customerPhone}`,
  ];

  if (order.comment) lines.push(`Коментар: ${order.comment}`);

  return lines.join('\n');
}

export function createTelegramNotifier(botToken: string, chatId: string): NotifierPort {
  async function send(text: string): Promise<void> {
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`Telegram sendMessage failed: ${response.status} ${body}`);
      }
    } catch (err) {
      console.error('Telegram sendMessage threw', err);
    }
  }

  return {
    orderCreated: (notification) => send(formatOrderMessage('Нове замовлення', notification)),
    orderPaid: (notification) => send(formatOrderMessage('Оплачено', notification)),
  };
}
