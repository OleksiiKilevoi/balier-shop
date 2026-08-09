import * as Sentry from '@sentry/cloudflare';
import { formatPrice } from '../money';
import type { CarrierAlert } from '../novaposhta/tracking';
import type { NotifierPort, OrderNotification } from '../ports';
import { DELIVERY_METHOD_LABELS, deliveryDestination, PAYMENT_METHOD_LABELS } from './format';

/**
 * Telegram Bot API adapter for `NotifierPort`. Sends into the manager chat the
 * bot was added to (`TELEGRAM_CHAT_ID`), distinct from `~/lib/telegram`'s
 * customer-facing deep link.
 *
 * Best-effort by the port's own contract: `send` never throws, so a Telegram
 * outage never fails order placement (`docs/OVERVIEW.md`, "Turnstile,
 * Telegram, email").
 */

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

/**
 * NP-4's manager alerts, cron-sent and Telegram-only — none of them concerns
 * the customer, so unlike `NotifierPort` there is no email half to no-op.
 * None of them moves an order either; that rule lives in
 * `~/lib/novaposhta/tracking.ts` and this is just how a human hears about it.
 */
export interface CarrierAlerts {
  /** An unhappy tracking code, first time it is seen. */
  carrierAlert(input: {
    orderNumber: string;
    ttn: string;
    alert: CarrierAlert;
    /** The carrier's own sentence, verbatim — an operator can act on it. */
    statusText: string;
  }): Promise<void>;
}

const CARRIER_ALERT_HEADINGS: Record<CarrierAlert, string> = {
  not_found: '⚠️ Нова Пошта не знає номера ТТН',
  refused: '⚠️ Відмова від посилки',
  storage_ended: '⚠️ Термін зберігання посилки закінчується або закінчився',
  returning: '⚠️ Посилка повертається відправнику',
  failed_delivery: '⚠️ Невдала спроба вручення',
};

export function formatCarrierAlert(input: {
  orderNumber: string;
  ttn: string;
  alert: CarrierAlert;
  statusText: string;
}): string {
  return [
    CARRIER_ALERT_HEADINGS[input.alert],
    `Замовлення ${input.orderNumber} · ТТН ${input.ttn}`,
    `Нова Пошта: ${input.statusText}`,
  ].join('\n');
}

/**
 * One Bot API `sendMessage`, best-effort: never throws, reports success as a
 * boolean and failure to the log. Shared by the notifier below (which ignores
 * the boolean — an outage must not fail order placement) and the Telegram
 * sign-in (login codes and webhook replies, which also carry on either way).
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!response.ok) {
      // Telegram is the alert channel *and* the OTP delivery channel — when
      // it fails, Sentry is the only place that shows it (`sentry.md`).
      const body = await response.text().catch(() => '');
      console.error(`Telegram sendMessage failed: ${response.status} ${body}`);
      Sentry.captureMessage(`Telegram sendMessage failed: ${response.status} ${body}`, 'error');
      return false;
    }

    return true;
  } catch (err) {
    console.error('Telegram sendMessage threw', err);
    Sentry.captureException(err);
    return false;
  }
}

export function createTelegramNotifier(
  botToken: string,
  chatId: string,
): NotifierPort & CarrierAlerts {
  async function send(text: string): Promise<void> {
    await sendTelegramMessage(botToken, chatId, text);
  }

  return {
    orderCreated: (notification) => send(formatOrderMessage('Нове замовлення', notification)),
    orderPaid: (notification) => send(formatOrderMessage('Оплачено', notification)),
    // The one webhook outcome that needs a person: money landed on an order
    // that is already cancelled, and nothing downstream will ever look at it
    // again. Loud on purpose — the fix is a manual refund.
    paymentAfterCancellation: (notification) =>
      send(
        formatOrderMessage(
          '⚠️ Оплата за СКАСОВАНИМ замовленням — потрібне повернення коштів',
          notification,
        ),
      ),
    carrierAlert: (input) => send(formatCarrierAlert(input)),
  };
}
