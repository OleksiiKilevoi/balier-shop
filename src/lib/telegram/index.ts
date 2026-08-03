/**
 * The «Замовити через Телеграм» CTA on the product page.
 *
 * Open decision 2, decided 2026-08-03: this is a **plain deep link** with the
 * product prefilled, not a second ordering path. It writes no order row, holds
 * no stock reservation and touches no payment — the manager picks the
 * conversation up in the chat. Anything that must reserve stock goes through the
 * cart and checkout, where the server can recalculate the total.
 *
 * Imported by both the page and its client script, so the message a customer
 * sends cannot drift from the one rendered server-side.
 */
import { formatPrice, type Kopiykas } from '~/lib/money';

/**
 * Telegram usernames: 5–32 of `[A-Za-z0-9_]`. Validated rather than trusted so a
 * misconfigured value produces no button instead of a link to a stranger.
 */
const USERNAME_PATTERN = /^[a-z0-9_]{5,32}$/i;

export interface TelegramOrderMessage {
  title: string;
  sku: string;
  /** Kopiykas, per unit. */
  price: Kopiykas;
  quantity: number;
  /** Absolute URL of the product page — the manager needs to open it. */
  url: string;
  /** Colour, when the product has a choice. */
  variantName?: string | null;
}

/** Plain text; Telegram prefills the composer with it and the customer sends it. */
export function orderMessage(order: TelegramOrderMessage): string {
  const name = order.variantName ? `${order.title}, ${order.variantName}` : order.title;

  return [
    'Доброго дня! Хочу замовити:',
    '',
    `${name} (${order.sku})`,
    `${formatPrice(order.price)} × ${order.quantity}`,
    order.url,
  ].join('\n');
}

/**
 * Returns null when no manager username is configured, so the caller leaves the
 * button out rather than rendering a link to nowhere.
 */
export function orderDeepLink(manager: string, order: TelegramOrderMessage): string | null {
  const username = manager.trim().replace(/^@/, '');
  if (!USERNAME_PATTERN.test(username)) return null;

  return `https://t.me/${username}?text=${encodeURIComponent(orderMessage(order))}`;
}
