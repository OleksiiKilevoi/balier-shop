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
 *
 * `paid` and `confirmed` appear here two ways: as the two faces of reverting
 * `packed`, and as one of the possible landings when undoing a `cancelled`/
 * `refunded` that started from `paid`/`confirmed` directly. Neither is ever a
 * forward transition (`ORDER_TRANSITION_LABELS` has no entry for either, on
 * purpose). `delivered` only appears here for the second case — undoing an
 * exit taken from `delivered` — since nothing else ever reverts onto it.
 */
export const ORDER_REVERT_LABELS: Partial<Record<OrderStatus, string>> = {
  paid: 'Повернути до «Оплачено»',
  confirmed: 'Повернути до «Підтверджено»',
  packed: 'Повернути до «Зібрано»',
  shipped: 'Повернути до «Відправлено»',
  delivered: 'Повернути до «Доставлено»',
};

/**
 * Shown under the revert button only when `revertCrossesPayment` says the step
 * back changes whether the order counts as paid — currently just cash on
 * delivery leaving `delivered`, since that is the only status where money
 * collection depends on having reached it exactly.
 */
export const ORDER_REVERT_PAYMENT_WARNING =
  'Товар вважатиметься ще не отриманим — накладений платіж надходить лише при видачі. «Скасувати» з’явиться замість «Повернено».';

/**
 * A per-target note under the revert button, for the one case where the
 * button's own label could be misread as an action rather than a correction:
 * «Повернути до «Оплачено»» only ever appears for a card order stepping back
 * out of `packed`, where the webhook already collected the money — this says
 * so, so it isn't mistaken for re-charging or re-verifying anything.
 */
export const ORDER_REVERT_HINTS: Partial<Record<OrderStatus, string>> = {
  paid: 'Оплату вже підтверджено Monobank раніше — це лише виправляє статус, гроші нікуди не звертаються.',
};

/**
 * Shown whenever the revert button would move an order *out of* `refunded`,
 * regardless of what it lands on (that varies with the order's own history —
 * see `orders.statusBeforeExit`). Money for a genuinely refunded order has
 * already left the business, by hand, in Monobank's dashboard — this button
 * only corrects the record for an order marked refunded *before* that
 * actually happened, and says so, so it is never mistaken for clawing money
 * back automatically.
 */
export const ORDER_REVERT_FROM_REFUNDED_WARNING =
  'Використовуйте, лише якщо кошти ще не повернено в Monobank. Ця дія не скасовує сам платіж — лише виправляє статус замовлення.';

/** Result of a POST, carried back through the redirect so a refresh is harmless. */
export const ADMIN_ORDER_MESSAGES = {
  status_updated: 'Статус замовлення оновлено.',
  ttn_updated: 'Номер накладної збережено.',
  ttn_cleared: 'Номер накладної видалено.',
  invalid_transition: 'Цей перехід недоступний для замовлення в такому статусі.',
  insufficient_stock: 'Недостатньо товару на складі, щоб повернути це замовлення — частину вже продано.',
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
