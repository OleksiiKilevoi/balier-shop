import type { AdminRole, OrderStatus, ParcelSize, ProductStatus } from '../db/schema';
import { MEDIA_FORMAT_LABELS } from '../media';
import { MAX_UPLOAD_BYTES } from '../media/upload';
import type { UploadIssue } from '../media/upload';
import {
  COD_LIMIT_MAX_HRYVNIAS,
  COD_LIMIT_MIN_HRYVNIAS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../validation/admin';
import { PRODUCT_PRICE_MAX_HRYVNIAS, PRODUCT_PRICE_MIN_HRYVNIAS } from '../validation/catalog';
import type { CatalogField } from '../validation/catalog';

/** UI strings for the admin panel. Ukrainian, like the storefront. */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Створюється',
  awaiting_payment: 'Очікує оплати',
  paid: 'Оплачено',
  confirmed: 'Підтверджено',
  packed: 'ТТН створено',
  shipped: 'Відправлено',
  /* NP codes 7/8/14 — at the branch or locker, waiting for the customer. */
  arrived: 'Доставлено',
  /* NP codes 9/10/11 — the handover; for COD also the moment the money exists. */
  delivered: 'Отримано',
  cancelled: 'Скасовано',
  refunded: 'Повернено',
};

/**
 * The button that produces each status — a verb, not the status name, because
 * the operator is recording something they did, not choosing a state.
 * Only the two exits carry a verb since NP-4: the forward chain has no
 * buttons at all — `packed` is «Створити ТТН»'s to set,
 * `shipped`/`arrived`/`delivered` are the tracking cron's
 * (`docs/plans/novaposhta.md`). The rest of the map
 * is the plain status labels, kept complete so an unexpected key still
 * renders words rather than nothing.
 */
export const ORDER_TRANSITION_LABELS: Record<OrderStatus, string> = {
  ...ORDER_STATUS_LABELS,
  cancelled: 'Скасувати замовлення',
  refunded: 'Позначити поверненим',
};

/** The status card's sentence where the forward buttons used to be. */
export const ADMIN_STATUS_CARRIER_HINT =
  'Статуси «Відправлено» і «Доставлено» оновлюються автоматично за даними Нової Пошти.';

/**
 * Shown under a transition button before it is pressed, where the consequence
 * is not obvious from the label. Neither undo touches money — that has to be
 * said, because «Позначити поверненим» sounds like it might issue the refund
 * itself. It does not: the money is returned in Monobank's own dashboard.
 *
 * Both hints used to promise «товар повернеться в наявність» as well. They no
 * longer do, and must not: since 2026-08-10 availability is a flag on the
 * variant that no order writes, so cancelling changes nothing about what the
 * shop is selling — if the piece is free again, somebody says so in the
 * catalog.
 */
export const ORDER_TRANSITION_HINTS: Partial<Record<OrderStatus, string>> = {
  cancelled: 'Наявність товару це не змінює — за потреби увімкніть її в каталозі.',
  refunded: 'Кошти повертаються вручну в Monobank. Наявність товару це не змінює.',
};

/**
 * The button that undoes a wrong click, keyed by the status it steps back to.
 * A verb of its own (`~/lib/orders/status.ts`'s `revertTarget`) rather than
 * reusing `ORDER_TRANSITION_LABELS`, since the same target status reads as
 * *progress* going forward but as *undo* going back.
 *
 * Since NP-4 the only revert the panel renders is undoing `cancelled`/
 * `refunded`, so every entry here is a possible `statusBeforeExit` landing —
 * which is why the whole committed chain appears. `paid`/`confirmed` are
 * never a forward transition (`ORDER_TRANSITION_LABELS` has no entry for
 * either, on purpose), and reverting `packed` itself is «Видалити ТТН»'s job,
 * not a status button's.
 */
export const ORDER_REVERT_LABELS: Partial<Record<OrderStatus, string>> = {
  paid: 'Повернути до «Оплачено»',
  confirmed: 'Повернути до «Підтверджено»',
  packed: 'Повернути до «ТТН створено»',
  shipped: 'Повернути до «Відправлено»',
  arrived: 'Повернути до «Доставлено»',
  delivered: 'Повернути до «Отримано»',
};

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
  invalid_transition: 'Цей перехід недоступний для замовлення в такому статусі.',
  stale: 'Замовлення вже змінилося — сторінку оновлено, спробуйте ще раз.',
  bad_request: 'Не вдалося виконати дію.',
  order_updated: 'Дані замовлення оновлено.',
  edit_ttn_exists:
    'У замовлення є накладна, і дані в ній не зміняться. Щоб редагувати замовлення, спочатку видаліть ТТН, а після змін створіть нову.',
  edit_locked: 'Замовлення вже відправлене або закрите — його дані не редагуються.',

  /* The waybill. */
  waybill_created: 'ТТН створено.',
  waybill_deleted: 'ТТН видалено — замовлення повернулося до попереднього статусу.',
  ttn_exists: 'У замовлення вже є накладна — другу не створено.',
  waybill_invalid_state: 'ТТН створюється лише для замовлення в статусі «Оплачено» або «Підтверджено».',
  no_waybill: 'У цього замовлення немає накладної.',
} as const;

export type AdminOrderMessage = keyof typeof ADMIN_ORDER_MESSAGES;

/* ------------------------------------------------------------- the waybill */

/**
 * Field-level refusals of «Створити ТТН», keyed by the schema's own issue
 * names (`waybillCreateSchema`). Rendered in place, not through the redirect:
 * the form holds nine values the operator should not have to retype.
 */
export const ADMIN_WAYBILL_ERRORS = {
  invalid_recipient_name:
    'Вкажіть прізвище та ім’я одержувача — два слова, як в паспорті. Замовлення це не змінює.',
  invalid_parcel_size: 'Оберіть коробку — до 2 кг або до 10 кг.',
  invalid_seats: 'Місця — ціле число від 1 до 99.',
  invalid_waybill_description: 'Опис вантажу — до 100 символів, не порожній.',
  invalid_declared_value: 'Оголошена вартість — цілі гривні, від 1.',
} as const;

export type AdminWaybillError = keyof typeof ADMIN_WAYBILL_ERRORS;

/**
 * Why the create form is not on the page, each one naming the fix. These are
 * states, not errors — the panel is usable long before the NP account is
 * configured, and the plan makes this form the place that says what is missing.
 */
export const ADMIN_WAYBILL_BLOCKERS = {
  senderIncomplete:
    'Не заповнено відправника Нової Пошти. У налаштуваннях, розділ «Нова Пошта — відправник»: натисніть «Підтягнути з акаунта», оберіть відділення й перевірте телефон.',
  noDeliveryCity:
    'Для відділення замовлення ще немає міста Нової Пошти в довіднику — його заповнює нічна синхронізація (або pnpm np:sync).',
  noApiKey: 'NOVAPOSHTA_API_KEY не налаштовано на цьому Worker — ТТН створити нізвідки.',
} as const;

/** The carrier said no — its own sentence, shown verbatim. */
export function npErrorText(message: string): string {
  return `Нова Пошта відхилила запит: ${message}`;
}

/** Label next to a hand-entered number, so nobody looks for a delete button. */
export const ADMIN_WAYBILL_MANUAL_NOTE =
  'Номер внесено вручну (ТТН створено в кабінеті Нової Пошти).';

/* ------------------------------------------------- register of shipments --- */

/**
 * Result of a `/registers` POST, carried back through the redirect. The same
 * map serves the list page and the register page — a delete lands its message
 * on the list, a create lands on the fresh register.
 */
export const ADMIN_REGISTER_MESSAGES = {
  register_created: 'Реєстр створено.',
  register_deleted: 'Реєстр видалено. Накладні з нього не постраждали.',
  register_order_removed: 'Замовлення знято з реєстру.',
  register_no_selection: 'Оберіть хоча б одне замовлення зі створеною ТТН.',
  register_orders_changed:
    'Замовлення встигли змінитися, реєстр не створено. Оновіть список і спробуйте ще раз.',
  not_on_register: 'Це замовлення вже не в цьому реєстрі.',
  bad_request: 'Не вдалося виконати дію.',
} as const;

export type AdminRegisterMessage = keyof typeof ADMIN_REGISTER_MESSAGES;

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
 * the order does not just sit there unpaid afterwards — the cron's sweep of
 * unpaid orders cancels it.
 */
export function cardLinkValidityText(minutes: number): string {
  return `Посилання на оплату дійсне ${minutes} хв. Якщо клієнт не оплатить за цей час, замовлення скасується автоматично.`;
}

/** The same deadline on the order page, where the exact moment is known. */
export function cardLinkExpiryText(deadline: string): string {
  return `Дійсне до ${deadline}. Після цього замовлення скасується автоматично.`;
}

export const ADMIN_CARD_LINK_EXPIRED =
  'Термін дії посилання минув. Замовлення скасується автоматично, якщо цього ще не сталося.';

/**
 * `/settings` — the cash-on-delivery limit and the signed-in user's own
 * password. Nothing else: managing other people's accounts moved to `/users`,
 * and took its own message map with it (below).
 *
 * One map because the screen has one banner. The keys are the schemas' own
 * issue names (`~/validation/admin`), so a rule is worded where it is enforced
 * and this file only translates it.
 *
 * The cod-limit refusal names the range rather than just saying "invalid",
 * because the field accepts one thing and rejects two different ways of getting
 * it wrong (a stray decimal point, and a value outside the bounds).
 */
export const ADMIN_SETTINGS_MESSAGES = {
  cod_limit_updated: 'Ліміт післяплати збережено.',
  promo_updated: 'Налаштування промокоду збережено.',
  invalid_promo_percent: 'Відсоток знижки — ціле число від 1 до 90.',
  invalid_cod_limit: `Вкажіть суму цілими гривнями — від ${COD_LIMIT_MIN_HRYVNIAS} до ${new Intl.NumberFormat('uk-UA').format(COD_LIMIT_MAX_HRYVNIAS)} ₴.`,
  bad_request: 'Не вдалося зберегти зміни.',

  /* Your own password. */
  password_changed: 'Пароль змінено.',
  wrong_password: 'Поточний пароль невірний.',
  password_too_short: `Новий пароль має містити щонайменше ${PASSWORD_MIN_LENGTH} символів.`,
  password_too_long: `Пароль задовгий — не більше ${PASSWORD_MAX_LENGTH} символів.`,
  passwords_do_not_match: 'Паролі не збігаються.',
  password_unchanged: 'Новий пароль такий самий, як поточний.',
  too_many_attempts: 'Забагато невдалих спроб. Спробуйте пізніше.',

  /* The Nova Poshta sender — admin-only section. */
  np_updated: 'Налаштування Нової Пошти збережено.',
  np_fetched: 'Дані акаунта Нової Пошти підтягнуто.',
  np_fetch_empty:
    'На цьому акаунті Нова Пошта ще не знає відправника. Зазвичай він з’являється після першої відправки, створеної в кабінеті.',
  np_place_updated: 'Відділення відправника збережено.',
  np_place_branch_not_found: 'Це відділення вже не знайшлося в довіднику — оберіть інше.',
  np_place_no_city:
    'Для цього відділення ще не синхронізовано місто Нової Пошти — дочекайтеся нічної синхронізації або запустіть pnpm np:sync.',
  invalid_np_phone: 'Телефон відправника — український мобільний: дев’ять цифр після +380.',
  invalid_np_description: 'Опис вантажу задовгий.',

  /* The Telegram sign-in — your own account, whatever the role. */
  telegram_link_created:
    'Посилання створено. Відкрийте його на пристрої з Telegram і натисніть Start.',
  telegram_unlinked: 'Telegram відв’язано. Вхід за кодом для цього акаунта вимкнено.',
} as const;

export type AdminSettingsMessage = keyof typeof ADMIN_SETTINGS_MESSAGES;

/** The message keys the screen shows in red rather than in grey. */
export const ADMIN_SETTINGS_FAILURES = new Set<AdminSettingsMessage>([
  'invalid_cod_limit',
  'invalid_promo_percent',
  'bad_request',
  'wrong_password',
  'password_too_short',
  'password_too_long',
  'passwords_do_not_match',
  'password_unchanged',
  'too_many_attempts',
  'np_fetch_empty',
  'np_place_branch_not_found',
  'np_place_no_city',
  'invalid_np_phone',
  'invalid_np_description',
]);

/**
 * `/users` — its own map, not a slice of the one above, because the two are now
 * two screens with one banner each. The overlap is two generic keys
 * (`bad_request`, `not_found`), which is a smaller price than a shared map
 * where half the entries can never appear on the screen reading it.
 *
 * The keys are again the schemas' issue names and the query layer's refusal
 * reasons, verbatim.
 */
export const ADMIN_USERS_MESSAGES = {
  user_created: 'Користувача створено.',
  user_saved: 'Зміни збережено.',
  user_password_set: 'Пароль користувача змінено.',
  user_archived: 'Користувача перенесено в архів. Його сеанси завершено.',
  user_restored: 'Користувача відновлено.',
  user_purged: 'Обліковий запис видалено назавжди. Пошту знову можна використати.',

  invalid_email: 'Вкажіть коректну адресу пошти.',
  /* Both password fields on this screen — the new account's and the reset —
     are the same `newPasswordSchema` as `/settings`, so they refuse in the
     same words. */
  password_too_short: `Пароль має містити щонайменше ${PASSWORD_MIN_LENGTH} символів.`,
  password_too_long: `Пароль задовгий — не більше ${PASSWORD_MAX_LENGTH} символів.`,
  /* Names the archive out loud: a colleague who was removed still holds the
     address, and «вже існує» with nothing on the active tab using it is the
     kind of answer that sends somebody looking for a bug. */
  email_taken: 'Користувач із такою поштою вже існує — можливо, він в архіві.',
  /* Not «помилка»: the refusal is the feature. Says who it is about, because
     the same sentence answers "disable", "demote" and "archive". */
  last_admin: 'Це єдиний активний адміністратор — спершу призначте іншого.',
  self_demote: 'Не можна змінити роль або вимкнути власний обліковий запис.',
  self_archive: 'Власний обліковий запис не архівують — це зробить інший адміністратор.',
  self_password: 'Власний пароль змінюють у «Налаштуваннях» — там потрібен поточний.',
  not_found: 'Користувача не знайдено — можливо, його змінили в іншій вкладці.',
  /* The purge guards, each naming what to do next rather than what failed. */
  not_archived:
    'Видалити назавжди можна лише те, що вже в архіві — цей запис відновили в іншій вкладці.',
  confirm_email: 'Пошта не збігається. Введіть адресу точно так, як вона показана вище.',
  /* A manager who reached one of these POSTs anyway: a stale tab open from
     before a demotion, or a hand-made request. */
  forbidden: 'Потрібні права адміністратора.',
  bad_request: 'Не вдалося зберегти зміни.',
} as const;

export type AdminUsersMessage = keyof typeof ADMIN_USERS_MESSAGES;

/** Shown in red rather than in grey — everything that is not a confirmation. */
export const ADMIN_USERS_FAILURES = new Set<AdminUsersMessage>([
  'invalid_email',
  'password_too_short',
  'password_too_long',
  'email_taken',
  'last_admin',
  'self_demote',
  'self_archive',
  'self_password',
  'not_found',
  'not_archived',
  'confirm_email',
  'forbidden',
  'bad_request',
]);

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  admin: 'Адміністратор',
  manager: 'Менеджер',
};

/**
 * What the two roles actually differ on, next to the role selector. One
 * sentence, because there is one difference — if this ever needs a list, the
 * roles have grown into permissions and the copy is the smallest of the
 * problems.
 */
export const ADMIN_ROLE_HINT =
  'Менеджер працює із замовленнями, каталогом і налаштуваннями. Адміністратор — те саме плюс керування користувачами.';

/**
 * Under the password section, and it now promises the opposite of what it used
 * to: changing a password ends every other session for the account, on every
 * device, immediately (`revokeAdminSessions`). Said out loud because it is the
 * reason somebody changes a password they still know.
 */
export const ADMIN_PASSWORD_HINT = `Щонайменше ${PASSWORD_MIN_LENGTH} символів. Після зміни всі інші сеанси цього облікового запису завершаться — на інших пристроях доведеться увійти знову.`;

/** The same promise, where an admin is switching somebody else off. */
export const ADMIN_USER_DISABLE_HINT =
  'Вимкнений користувач не зможе ввійти, а його поточний сеанс завершиться одразу.';

/**
 * The three ways an account can be taken away, in the order they cost, said
 * once at the top of `/users` — because the difference between them is the one
 * thing the buttons themselves cannot explain.
 */
export const ADMIN_USERS_HINT =
  'Тут створюють облікові записи панелі. Вимкнений користувач лишається у списку й повертається одним кліком; архівований зникає зі списку, але його можна відновити. Видалити назавжди — тільки з архіву.';

/** Under the archive tab, where every row is one action away from being gone. */
export const ADMIN_ARCHIVE_HINT =
  'Ці облікові записи не можуть увійти. Відновлення повертає їх у список у тому ж стані. Видалення назавжди прибирає рядок разом із записом про входи й звільняє пошту.';

/**
 * Under the limit field. Says what the number does at checkout, in the same
 * terms the customer sees it (`codOverLimitText`), and says the one thing the
 * screen deliberately cannot do — a manager looking for the off switch should
 * find out here rather than by setting the limit to 1 ₴ and hoping.
 */
export const ADMIN_PROMO_HINT =
  'Через хвилину на сайті відвідувачу пропонують знижку за e-mail: код приходить листом, один на адресу, діє на одне замовлення. Скидка рахується від суми товарів, без доставки.';

export const ADMIN_COD_LIMIT_HINT =
  'Замовлення, дорожчі за цю суму, не можна оформити з післяплатою — на сайті залишиться тільки оплата карткою.';

/**
 * Why half-empty is fine, said out loud: the section exists before the client's
 * NP account does, and the screen that pays for a missing value is the waybill
 * form, which names it. Without this sentence a row of empty Ref fields reads
 * as a broken page rather than a not-yet-configured account.
 */
export const ADMIN_NP_SENDER_HINT =
  'Дані відправника для створення ТТН. Відправник підтягується з акаунта, відділення обирається пошуком.';

/**
 * The «Вхід через Telegram» section of `/settings`. Says what linking buys and
 * where the codes will arrive, because a button called «Створити посилання»
 * explains neither.
 */
export const ADMIN_TELEGRAM_HINT =
  'Прив’яжіть особистий Telegram — і зможете входити в панель за одноразовим кодом замість пароля. Коди надходитимуть від бота у ваш особистий чат.';

/* ------------------------------------------------- what the bot itself says */

/**
 * Sent into the operator's private chat by the webhook and the login page —
 * the bot's entire vocabulary. Kept here with the rest of the panel's
 * Ukrainian rather than inline in the route, same rule as every screen.
 */
export function telegramLinkedText(email: string): string {
  return `✅ Telegram прив’язано до ${email}. Тепер на сторінці входу в панель можна отримувати сюди одноразові коди.`;
}

/** One sentence for «unknown», «expired» and «account gone» alike — a stranger probing codes learns nothing from the wording. */
export const TELEGRAM_LINK_INVALID_TEXT =
  'Посилання недійсне або протерміноване. Створіть нове в панелі: Налаштування → Вхід через Telegram.';

export const TELEGRAM_CHAT_TAKEN_TEXT =
  'Цей Telegram уже прив’язано до іншого облікового запису панелі. Спершу відв’яжіть його там.';

export function telegramOtpText(code: string): string {
  return `Код входу в панель: ${code}\nДіє 5 хвилин. Якщо це не ви — нічого не робіть, без коду ніхто не ввійде.`;
}

/* ------------------------------------------------------------- the catalog */

/** The two boxes of `PARCEL_SIZES`, as the product editor and the waybill form name them. */
export const PARCEL_SIZE_LABELS: Record<ParcelSize, string> = {
  small: 'До 2 кг',
  large: 'До 10 кг',
};

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
  categoryId: 'Оберіть категорію зі списку.',
  parcelSize: 'Оберіть коробку — до 2 кг або до 10 кг.',
  position: 'Порядок — ціле число від 0.',
  sku: 'Тільки великі латинські літери, цифри й дефіси — наприклад, SUMKA-LIUNET-CHORNYI.',
  colorName: 'Назва кольору задовга.',
  colorHex: 'Колір у форматі #1a1a1a.',
  priceOverride: 'Своя ціна варіанта — ціле число гривень або порожнє поле.',
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
  noneInStock:
    'Жоден варіант не позначено як «в наявності» — товар видно в каталозі, але кнопка «Додати до кошика» вимкнена.',
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

  /* `/login/telegram`. `otp_sent` is worded conditionally on purpose — the
     same sentence whether a code went out or the address matched nothing, so
     the form cannot be used to list the admins (`invalid_credentials`'s rule,
     applied to the other door). */
  otp_sent: 'Якщо такий акаунт існує і Telegram прив’язано — код надіслано. Він діє 5 хвилин.',
  invalid_code: 'Невірний або протермінований код. Можна запросити новий.',
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
