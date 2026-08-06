import type { OrderStatus, ProductStatus } from '../db/schema';
import { MEDIA_FORMAT_LABELS } from '../media';
import { EXPECTED_HEIGHT, EXPECTED_WIDTH, MAX_UPLOAD_BYTES } from '../media/upload';
import type { UploadIssue } from '../media/upload';
import { COD_LIMIT_MAX_HRYVNIAS, COD_LIMIT_MIN_HRYVNIAS } from '../validation/admin';
import { PRODUCT_PRICE_MAX_HRYVNIAS, PRODUCT_PRICE_MIN_HRYVNIAS } from '../validation/catalog';
import type { CatalogField } from '../validation/catalog';

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
 * `/admin/settings` — currently the cash-on-delivery limit and nothing else.
 *
 * The refusal names the range rather than just saying "invalid", because the
 * field accepts one thing and rejects two different ways of getting it wrong
 * (a stray decimal point, and a value outside the bounds).
 */
export const ADMIN_SETTINGS_MESSAGES = {
  cod_limit_updated: 'Ліміт післяплати збережено.',
  invalid_cod_limit: `Вкажіть суму цілими гривнями — від ${COD_LIMIT_MIN_HRYVNIAS} до ${new Intl.NumberFormat('uk-UA').format(COD_LIMIT_MAX_HRYVNIAS)} ₴.`,
  bad_request: 'Не вдалося зберегти зміни.',
} as const;

export type AdminSettingsMessage = keyof typeof ADMIN_SETTINGS_MESSAGES;

/**
 * Under the limit field. Says what the number does at checkout, in the same
 * terms the customer sees it (`codOverLimitText`), and says the one thing the
 * screen deliberately cannot do — a manager looking for the off switch should
 * find out here rather than by setting the limit to 1 ₴ and hoping.
 */
export const ADMIN_COD_LIMIT_HINT =
  'Замовлення, дорожчі за цю суму, не можна оформити з післяплатою — на сайті залишиться тільки оплата карткою.';

/* ------------------------------------------------------------- the catalog */

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Чернетка',
  active: 'У продажу',
  archived: 'В архіві',
};

/**
 * What each status *does*, shown next to the selector on the product form.
 *
 * `draft` and `archived` are indistinguishable to a customer — both are simply
 * not there — but they mean opposite things to the shop, so the copy separates
 * them by intent rather than by effect.
 */
export const PRODUCT_STATUS_HINTS: Record<ProductStatus, string> = {
  draft: 'Ще не опубліковано. Товару немає ні в каталозі, ні в пошуку, ні за прямим посиланням.',
  active: 'Опубліковано. Товар є в каталозі, у пошуку та за прямим посиланням.',
  archived: 'Знято з продажу. З каталогу зникає, але залишається в панелі та в історії замовлень.',
};

/**
 * Result of a POST on the catalog screens.
 *
 * The refusals outnumber the confirmations because most of what can go wrong
 * here is a collision with something the manager cannot see from this page — a
 * slug another product already holds, a SKU on a variant of a different product.
 * Each of those names the conflict rather than saying «не вдалося».
 */
export const ADMIN_PRODUCT_MESSAGES = {
  created: 'Товар створено. Далі — опис, варіанти та фото.',
  saved: 'Зміни збережено.',
  variant_added: 'Варіант додано.',
  variant_saved: 'Варіант збережено.',
  variant_activated: 'Варіант знову в продажу.',
  variant_deactivated: 'Варіант знято з продажу.',
  image_added: 'Фото додано.',
  image_saved: 'Фото збережено.',
  image_moved: 'Порядок фото змінено.',
  image_removed: 'Фото прибрано з товару.',
  slug_taken: 'Таку адресу вже займає інший товар. Змініть slug.',
  sku_taken: 'Такий артикул уже існує — SKU має бути унікальним у всьому каталозі.',
  last_active_variant:
    'Це єдиний варіант у продажу. Якщо зняти і його, товар зникне зі сторінки навіть у статусі «У продажу» — спершу додайте інший варіант або переведіть товар в архів.',
  not_found: 'Рядок не знайдено — можливо, його вже змінили в іншій вкладці.',
  conflict: 'Такий запис уже існує.',
  bad_request: 'Не вдалося зберегти зміни.',
} as const;

export type AdminProductMessage = keyof typeof ADMIN_PRODUCT_MESSAGES;

/**
 * «WebP, AVIF, JPEG і PNG» — read off `MEDIA_FORMATS` rather than typed out, so
 * the sentence the manager reads cannot claim support the bucket does not have.
 * Both the hint and the refusal below are built from this one string.
 */
const SUPPORTED_FORMATS = new Intl.ListFormat('uk-UA', { type: 'conjunction' }).format(
  Object.values(MEDIA_FORMAT_LABELS),
);

/** The byte cap as the manager sees it, in both sentences that mention it. */
const MAX_UPLOAD_MEGABYTES = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

/**
 * Why an uploaded file was refused.
 *
 * Only four things can refuse a photo now — see `~/lib/media/upload` for why the
 * pixel rules went. Each of the four is about the file rather than the picture,
 * and the message says what to do to the file, not what rule it broke.
 */
export const ADMIN_UPLOAD_ERRORS: Record<UploadIssue, string> = {
  empty: 'Оберіть файл.',
  too_large: `Файл завеликий — до ${MAX_UPLOAD_MEGABYTES} МБ. Експортуйте фото ще раз із меншою якістю.`,
  unreadable: 'Не вдалося прочитати це зображення. Можливо, файл пошкоджено або це не фото.',
  unsupported_format: `Підтримуються тільки ${SUPPORTED_FORMATS}.`,
};

/**
 * A stored file's size, for the photo rows in the product editor.
 *
 * Whole kilobytes up to a megabyte and one decimal above it, because the only
 * decision behind this number is «is this photo too heavy for the page» — and
 * nothing here resizes, so that decision is the manager's to make with a new
 * export. Bytes appear only under a kilobyte, where rounding to 0 КБ would look
 * like a broken row rather than a small file.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;

  const kilobytes = bytes / 1024;
  // Rounded before the comparison, not after: 1 048 575 B is 1023.999 KB, and
  // testing the unrounded value would print «1024 КБ» instead of «1 МБ».
  if (Math.round(kilobytes) < 1024) return `${Math.round(kilobytes)} КБ`;

  const megabytes = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 }).format(
    kilobytes / 1024,
  );
  return `${megabytes} МБ`;
}

/**
 * Stated on the upload control, in the order a file can fail: the two hard
 * limits that will actually refuse it — the formats and the byte cap — then the
 * pixels, which refuse nothing and are only a recommendation now.
 */
export const ADMIN_UPLOAD_HINT = `Формати: ${SUPPORTED_FORMATS}, до ${MAX_UPLOAD_MEGABYTES} МБ.`;

/**
 * Messages under individual controls, keyed by the field
 * `catalogFieldErrors` names. Same idea as `ADMIN_NEW_ORDER_ERRORS`: each one
 * names the fix, not the rule.
 */
export const ADMIN_CATALOG_ERRORS: Record<CatalogField, string> = {
  title: 'Вкажіть назву.',
  slug: 'Тільки малі латинські літери, цифри й дефіси — наприклад, sumka-liunet.',
  description: 'Опис задовгий.',
  details: 'Деталі задовгі.',
  dimensions: 'Задовгий рядок розмірів.',
  metaTitle: 'Заголовок для пошукових систем задовгий.',
  metaDescription: 'Опис для пошукових систем задовгий.',
  basePrice: `Вкажіть ціну цілими гривнями — від ${PRODUCT_PRICE_MIN_HRYVNIAS} до ${new Intl.NumberFormat('uk-UA').format(PRODUCT_PRICE_MAX_HRYVNIAS)} ₴.`,
  compareAtPrice: 'Стара ціна має бути цілим числом гривень або порожньою.',
  categoryId: 'Оберіть категорію зі списку.',
  position: 'Порядок — ціле число від 0.',
  sku: 'Тільки великі латинські літери, цифри й дефіси — наприклад, SUMKA-LIUNET-CHORNYI.',
  colorName: 'Назва кольору задовга.',
  colorHex: 'Колір у форматі #1a1a1a.',
  priceOverride: 'Своя ціна варіанта — ціле число гривень або порожнє поле.',
  stock: 'Залишок — ціле число від 0.',
  alt: 'Опис зображення задовгий.',
};

/**
 * The four things about the storefront that the editor cannot show by simply
 * rendering the row, and that a manager would otherwise discover by wondering
 * why the shop disagrees with the form in front of them.
 */
export const ADMIN_STOREFRONT_NOTES = {
  price:
    'Ціна на картці — найдешевший варіант у продажу. Своя ціна на одному варіанті змінює те, що бачить покупець у каталозі.',
  leadImage: 'Перше фото в списку — те, що показує картка товару в каталозі та в пошуку.',
  slugChange:
    'Товар опубліковано: зміна адреси зламає наявні поза сайтом посилання на нього.',
  noVariants:
    'Немає жодного варіанта в продажу — сторінка товару віддає 404 навіть у статусі «У продажу».',
  noImages: 'Немає фото — картка в каталозі буде порожньою.',
} as const;

/** `/admin/categories`. */
export const ADMIN_CATEGORY_MESSAGES = {
  created: 'Категорію створено.',
  saved: 'Категорію збережено.',
  slug_taken: 'Таку адресу вже займає інша категорія.',
  not_found: 'Категорію не знайдено.',
  bad_request: 'Не вдалося зберегти категорію.',
} as const;

export type AdminCategoryMessage = keyof typeof ADMIN_CATEGORY_MESSAGES;

/**
 * Deactivating a category is as close to deleting as the panel goes, and what
 * it does is not obvious: the products stay put and keep the category's name on
 * their page, they just lose the link to a listing that would now 404.
 */
export const ADMIN_CATEGORY_HINT =
  'Знята з публікації категорія зникає з каталогу, але товари залишаються на місці й зберігають її назву. Видалити категорію не можна — це очистило б поле категорії в усіх її товарах.';

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
