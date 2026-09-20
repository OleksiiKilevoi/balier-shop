import * as Sentry from '@sentry/cloudflare';
import { formatPrice } from '../money';
import type { NotifierPort, OrderNotification } from '../ports';
import { DELIVERY_METHOD_LABELS, deliveryDestination, PAYMENT_METHOD_LABELS } from './format';

/**
 * Cloudflare Email Sending adapter for `NotifierPort` — the customer-facing
 * counterpart to `./telegram`'s manager notifications. Same best-effort
 * contract: `send` never throws, so an email outage never fails checkout
 * (`docs/OVERVIEW.md`, "Turnstile, Telegram, email").
 *
 * Trigger points deliberately differ from Telegram's (decided 2026-08-04):
 * cash on delivery is genuinely confirmed the moment the order is created, so
 * `orderCreated` sends then. A card order is not confirmed until Monobank
 * actually reports the payment succeeded, so `orderCreated` is a no-op for
 * `card` — only `orderPaid`, fired from the webhook's `paid` transition,
 * sends the confirmation. If the customer abandons payment, no email ever
 * goes out for that order, which is correct: nothing was confirmed.
 * `customerEmail` is optional at checkout, so both methods are silent no-ops
 * when it's absent — this is not an error worth logging.
 */

interface OrderEmail {
  subject: string;
  text: string;
  html: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

export function formatOrderEmail(notification: OrderNotification): OrderEmail {
  const { order, items } = notification;

  const itemLines = items.map((item) => {
    const name = item.variantName ? `${item.productTitle}, ${item.variantName}` : item.productTitle;
    return `${name} (${item.sku}) — ${item.quantity} × ${formatPrice(item.unitPrice)}`;
  });

  const subject = `Замовлення ${order.orderNumber} підтверджено — Balier`;

  const textLines = [
    `Дякуємо за замовлення, ${order.customerName}!`,
    '',
    `Замовлення ${order.orderNumber}:`,
    ...itemLines.map((line) => `• ${line}`),
    '',
    ...(order.discountTotal > 0
      ? [`Знижка (${order.promoCode ?? 'промокод'}): −${formatPrice(order.discountTotal)}`]
      : []),
    `Разом: ${formatPrice(order.total)}`,
    `Оплата: ${PAYMENT_METHOD_LABELS[order.paymentMethod]}`,
    `Доставка: ${DELIVERY_METHOD_LABELS[order.deliveryMethod]} — ${deliveryDestination(order)}`,
  ];
  if (order.comment) textLines.push(`Коментар: ${order.comment}`);
  textLines.push('', 'Дякуємо, що обрали Balier.');

  const text = textLines.join('\n');

  const html = [
    `<p>Дякуємо за замовлення, ${escapeHtml(order.customerName)}!</p>`,
    `<p>Замовлення <strong>${escapeHtml(order.orderNumber)}</strong>:</p>`,
    `<ul>${itemLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
    order.discountTotal > 0
      ? `<p>Знижка (${escapeHtml(order.promoCode ?? 'промокод')}): −${escapeHtml(formatPrice(order.discountTotal))}</p>`
      : '',
    `<p>Разом: <strong>${escapeHtml(formatPrice(order.total))}</strong><br>`,
    `Оплата: ${escapeHtml(PAYMENT_METHOD_LABELS[order.paymentMethod])}<br>`,
    `Доставка: ${escapeHtml(DELIVERY_METHOD_LABELS[order.deliveryMethod])} — ${escapeHtml(deliveryDestination(order))}</p>`,
    order.comment ? `<p>Коментар: ${escapeHtml(order.comment)}</p>` : '',
    `<p>Дякуємо, що обрали Balier.</p>`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, text, html };
}

export function createEmailNotifier(email: SendEmail, fromAddress: string): NotifierPort {
  async function send(notification: OrderNotification): Promise<void> {
    const { customerEmail } = notification.order;
    if (!customerEmail) return;

    const { subject, text, html } = formatOrderEmail(notification);

    try {
      await email.send({
        to: customerEmail,
        from: { name: 'Balier', email: fromAddress },
        subject,
        text,
        html,
      });
    } catch (err) {
      console.error('Order confirmation email failed to send', err);
      Sentry.captureException(err);
    }
  }

  return {
    orderCreated: (notification) =>
      notification.order.paymentMethod === 'cod' ? send(notification) : Promise.resolve(),
    orderPaid: (notification) => send(notification),
    // Deliberate no-op: the customer must not get an order *confirmation* for a
    // cancelled order. The manager's Telegram alert carries this case, and the
    // refund conversation happens by phone — the number every order has.
    paymentAfterCancellation: () => Promise.resolve(),
  };
}

/* ------------------------------------------------------------ promo code */

export interface PromoCodeEmailInput {
  to: string;
  code: string;
  percent: number;
  /** Absolute origin, for the catalog link. */
  siteUrl: string;
}

export function formatPromoCodeEmail(input: PromoCodeEmailInput): OrderEmail {
  const catalogUrl = new URL('/products', input.siteUrl).href;
  const subject = `Ваш промокод BÁLIER: −${input.percent} % на перше замовлення`;
  const text = [
    `Дякуємо за інтерес до BÁLIER.`,
    '',
    `Ваш промокод: ${input.code}`,
    `Знижка ${input.percent} % на суму товарів. Введіть код у полі «Промокод» під час оформлення замовлення.`,
    `Код діє один раз, на одне замовлення.`,
    '',
    `Обрати виріб: ${catalogUrl}`,
    '',
    'BÁLIER — шкіряні вироби ручної роботи, Дніпро.',
  ].join('\n');
  const html = [
    `<p>Дякуємо за інтерес до BÁLIER.</p>`,
    `<p>Ваш промокод: <strong style="font-size:1.25em;letter-spacing:0.08em">${escapeHtml(input.code)}</strong></p>`,
    `<p>Знижка ${input.percent} % на суму товарів. Введіть код у полі «Промокод» під час оформлення замовлення.<br>`,
    `Код діє один раз, на одне замовлення.</p>`,
    `<p><a href="${escapeHtml(catalogUrl)}">Обрати виріб</a></p>`,
    `<p>BÁLIER — шкіряні вироби ручної роботи, Дніпро.</p>`,
  ].join('\n');
  return { subject, text, html };
}

/**
 * The one e-mail the storefront sends outside an order. Throws on failure —
 * unlike the order confirmations, the caller has a customer waiting on the
 * popup and must tell them to try again rather than pretend it went out.
 */
export async function sendPromoCodeEmail(
  email: SendEmail,
  fromAddress: string,
  input: PromoCodeEmailInput,
): Promise<void> {
  const { subject, text, html } = formatPromoCodeEmail(input);
  await email.send({
    to: input.to,
    from: { name: 'Balier', email: fromAddress },
    subject,
    text,
    html,
  });
}
