import type { OrderStatus } from '~/lib/db/schema';

/** UI strings for the admin panel. Ukrainian, like the storefront. */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Створюється',
  awaiting_payment: 'Очікує оплати',
  paid: 'Оплачено',
  confirmed: 'Підтверджено',
  packed: 'Зібрано',
  shipped: 'Відправлено',
  delivered: 'Доставлено',
  cancelled: 'Скасовано',
  refunded: 'Повернено',
};

/**
 * The button that produces each status — a verb, not the status name, because
 * the operator is recording something they did, not choosing a state.
 * Only the statuses `~/lib/orders/status.ts` can actually produce appear here.
 */
export const ORDER_TRANSITION_LABELS: Record<OrderStatus, string> = {
  ...ORDER_STATUS_LABELS,
  packed: 'Позначити зібраним',
  shipped: 'Позначити відправленим',
  delivered: 'Позначити доставленим',
  cancelled: 'Скасувати замовлення',
  refunded: 'Позначити поверненим',
};

/**
 * Shown under a transition button before it is pressed, where the consequence
 * is not obvious from the label. Both undo actions put stock back, and neither
 * touches money — that has to be said, because «Позначити поверненим» sounds
 * like it might issue the refund itself. It does not: the money is returned in
 * Monobank's own dashboard.
 */
export const ORDER_TRANSITION_HINTS: Partial<Record<OrderStatus, string>> = {
  cancelled: 'Товар повернеться в наявність.',
  refunded: 'Кошти повертаються вручну в Monobank. Товар повернеться в наявність.',
};

/**
 * The button that undoes a wrong click, keyed by the status it steps back to.
 * A verb of its own (`~/lib/orders/status.ts`'s `revertTarget`) rather than
 * reusing `ORDER_TRANSITION_LABELS`, since the same target status reads as
 * *progress* going forward but as *undo* going back — «Позначити зібраним»
 * would be a strange thing to click while looking at a `shipped` order.
 */
export const ORDER_REVERT_LABELS: Partial<Record<OrderStatus, string>> = {
  packed: 'Повернути до «Зібрано»',
  shipped: 'Повернути до «Відправлено»',
};

/**
 * Shown under the revert button only when `revertCrossesPayment` says the step
 * back changes whether the order counts as paid — currently just cash on
 * delivery leaving `delivered`, since that is the only status where money
 * collection depends on having reached it exactly.
 */
export const ORDER_REVERT_PAYMENT_WARNING =
  'Товар вважатиметься ще не отриманим — накладений платіж надходить лише при видачі. «Скасувати» з’явиться замість «Повернено».';

/** Result of a POST, carried back through the redirect so a refresh is harmless. */
export const ADMIN_ORDER_MESSAGES = {
  status_updated: 'Статус замовлення оновлено.',
  ttn_updated: 'Номер накладної збережено.',
  ttn_cleared: 'Номер накладної видалено.',
  invalid_transition: 'Цей перехід недоступний для замовлення в такому статусі.',
  stale: 'Замовлення вже змінилося — сторінку оновлено, спробуйте ще раз.',
  invalid_tracking_number: 'Номер накладної має складатися з 14 цифр.',
  bad_request: 'Не вдалося виконати дію.',
} as const;

export type AdminOrderMessage = keyof typeof ADMIN_ORDER_MESSAGES;

/**
 * Timestamps are stored with a timezone and the Worker runs in UTC, so they are
 * rendered in Kyiv time explicitly — an operator matching a row against a phone
 * call needs the clock on their own wall, not the server's.
 */
const dateTimeFormatter = new Intl.DateTimeFormat('uk-UA', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Kyiv',
});

export function formatAdminDateTime(value: Date): string {
  return dateTimeFormatter.format(value);
}
