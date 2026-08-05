import type { OrderStatus } from '~/lib/db/schema';

/** UI strings for the admin panel. Ukrainian, like the storefront. */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Створюється',
  awaiting_payment: 'Очікує оплати',
  paid: 'Оплачено',
  confirmed: 'Підтверджено',
  packed: 'Упаковано',
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
  packed: 'Позначити упакованим',
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
 * *progress* going forward but as *undo* going back — «Позначити упакованим»
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
  packed: 'Повернути до «Упаковано»',
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
  created: 'Замовлення створено.',
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
 * The order a manager types in themselves — `/admin/orders/new`.
 *
 * Messages sit next to the control that has to change, so each one names the
 * fix rather than the rule that was broken. The phone is the one worth spelling
 * out: it is the field most often pasted out of a chat message, and the only
 * one with a format that silently rejects an otherwise perfectly real number.
 */
export const ADMIN_NEW_ORDER_ERRORS = {
  customerName: 'Вкажіть ім’я клієнта — щонайменше два символи.',
  customerPhone: 'Потрібен український мобільний — дев’ять цифр після +380.',
  customerEmail: 'Схоже, у пошті помилка. Її можна лишити порожньою.',
  settlement: 'Оберіть населений пункт.',
  warehouse: 'Оберіть відділення або поштомат.',
  address: 'Вкажіть адресу для кур’єра — від 5 до 200 символів.',
  items: 'Додайте щонайменше один товар.',
} as const;

/**
 * A refusal that belongs to the order as a whole rather than to one field.
 *
 * `cart_changed` is the same repricing refusal a customer gets at checkout: the
 * order is never created from what the screen last showed, always from what the
 * database says at that moment, so a variant that sold out while the manager
 * was typing stops the order rather than overselling it.
 */
export const ADMIN_NEW_ORDER_MESSAGES = {
  cart_changed:
    'Наявність змінилася, поки замовлення складали. Нічого не створено — перевірте товари нижче.',
  payment_failed:
    'Monobank не видав рахунок, тож замовлення не створено. Спробуйте ще раз або оформіть накладений платіж.',
} as const;

/**
 * Shown next to the «карткою» option and again above a created card order's
 * link. Both halves matter and neither is obvious: the link stops working, and
 * the order does not just sit there unpaid afterwards — the cron that releases
 * expired reservations cancels it.
 */
export function cardLinkValidityText(minutes: number): string {
  return `Посилання на оплату дійсне ${minutes} хв. Якщо клієнт не оплатить за цей час, замовлення скасується автоматично й товар повернеться в наявність.`;
}

/** The same deadline on the order page, where the exact moment is known. */
export function cardLinkExpiryText(deadline: string): string {
  return `Дійсне до ${deadline}. Після цього замовлення скасується автоматично й товар повернеться в наявність.`;
}

export const ADMIN_CARD_LINK_EXPIRED =
  'Термін дії посилання минув. Замовлення скасується автоматично, якщо цього ще не сталося.';

/**
 * Sign-in results.
 *
 * `invalid_credentials` is one message for two different failures — no such
 * address, and the wrong password for a real one. Naming which of the two it
 * was would turn the form into a way to find out who the admins are, and the
 * operator gains nothing from the distinction: they retype the same two fields
 * either way.
 */
export const ADMIN_AUTH_MESSAGES = {
  invalid_credentials: 'Невірна пошта або пароль.',
  too_many_attempts: 'Забагато невдалих спроб входу.',
  session_expired: 'Сесія завершилася. Увійдіть ще раз.',
  signed_out: 'Ви вийшли з панелі.',
  unavailable: 'Вхід тимчасово недоступний. Зверніться до розробника.',
} as const;

export type AdminAuthMessage = keyof typeof ADMIN_AUTH_MESSAGES;

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
