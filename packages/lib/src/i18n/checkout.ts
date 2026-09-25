import type { OrderStatus, PaymentMethod } from '../db/schema';
import { formatPrice, type Kopiykas } from '../money';
import type { CheckoutNotice } from '../orders/checkoutCart';

/**
 * Checkout's dynamic Ukrainian text — built in the browser or from a live
 * order status, same reasoning as `~/lib/i18n/cart`.
 */

/**
 * Unlike `cartNoticeText`, checkout does not correct the cart — it refuses the
 * whole order — so this only says what changed and why the customer needs to
 * go back to `/cart`.
 */
export function checkoutNoticeText(notice: CheckoutNotice): string {
  const name = notice.title ? `«${notice.title}»` : 'Один із товарів';

  switch (notice.reason) {
    case 'unavailable':
      return `${name} більше не продається.`;
    case 'out_of_stock':
      return `${name} закінчився.`;
  }
}

/** What the checkout says under the promo field when the server refuses the code. */
export const PROMO_ERROR_TEXT = {
  promo_invalid: 'Такого промокоду немає або акцію вимкнено. Перевірте код із листа.',
  promo_used: 'Цей промокод уже використано. Один код діє на одне замовлення.',
  promo_not_first: 'Цей промокод діє лише на перше замовлення.',
} as const;

export function codOverLimitText(limitKopiykas: Kopiykas): string {
  return `Оплата готівкою при отриманні доступна для замовлень до ${formatPrice(limitKopiykas)}. Оберіть оплату карткою.`;
}

/**
 * Nova Poshta's own reference list (`AddressGeneral/getSettlementTypes`,
 * confirmed live) has exactly these four settlement types — a fixed
 * classification of Ukraine's administrative units, not something NP's data
 * changes shape on. `np_settlements.type` stores the label as-is
 * (`SettlementTypeDescription`); this is only the display abbreviation.
 */
const SETTLEMENT_TYPE_ABBREVIATIONS: Record<string, string> = {
  місто: 'м.',
  село: 'с.',
  селище: 'с-ще',
  'селище міського типу': 'смт',
};

/** `/checkout`'s settlement picker */
export function settlementLabel(settlement: {
  name: string;
  type: string | null;
  area: string | null;
}): string {
  const prefix = settlement.type ? (SETTLEMENT_TYPE_ABBREVIATIONS[settlement.type] ?? '') : '';
  const name = prefix ? `${prefix} ${settlement.name}` : settlement.name;
  return settlement.area ? `${name} - ${settlement.area} обл.` : name;
}

export interface OrderStatusCopy {
  heading: string;
  body: string;
}

/**
 * `/checkout/success` reads live order status rather than assuming the
 * redirect means the payment went through — this is what it shows for each
 * state the order can actually be in when the page loads.
 */
export function orderStatusCopy(status: OrderStatus, paymentMethod: PaymentMethod): OrderStatusCopy {
  if (paymentMethod === 'parts') {
    if (status === 'awaiting_payment' || status === 'pending') {
      return {
        heading: 'Підтвердіть заявку в застосунку monobank',
        body: 'Ми надіслали заявку на Покупку Частинами. Відкрийте застосунок monobank, оберіть кількість платежів і підтвердіть — на це є 15 хвилин. Сторінка оновиться сама.',
      };
    }
    if (status === 'paid') {
      return {
        heading: 'Заявку схвалено',
        body: 'Покупку Частинами оформлено. Графік платежів — у застосунку monobank. Менеджер зв’яжеться з вами щодо доставки.',
      };
    }
    if (status === 'cancelled') {
      return {
        heading: 'Заявку не схвалено',
        body: 'Покупку Частинами не оформлено — заявку відхилено або час на підтвердження минув. Спробуйте оформити замовлення ще раз з оплатою карткою.',
      };
    }
  }
  switch (status) {
    case 'paid':
      return {
        heading: 'Дякуємо! Оплату отримано',
        body: 'Ми починаємо збирати ваше замовлення. Менеджер зв’яжеться з вами щодо доставки.',
      };
    case 'confirmed':
      return paymentMethod === 'cod'
        ? {
            heading: 'Замовлення прийнято',
            body: 'Оплата — готівкою при отриманні на відділенні Нової Пошти. Менеджер зв’яжеться з вами щодо доставки.',
          }
        : { heading: 'Замовлення підтверджено', body: 'Менеджер зв’яжеться з вами щодо доставки.' };
    case 'awaiting_payment':
      return {
        heading: 'Очікуємо підтвердження оплати',
        body: 'Це займає лише кілька хвилин. Статус замовлення оновиться автоматично, оновіть сторінку трохи пізніше.',
      };
    case 'pending':
      return {
        heading: 'Замовлення створено',
        body: 'Завершіть оформлення, щоб ми могли його обробити.',
      };
    case 'cancelled':
      return {
        heading: 'Оплату не завершено',
        body: 'Замовлення скасовано, товар не заброньовано. Спробуйте оформити його ще раз.',
      };
    default:
      return {
        heading: 'Замовлення в обробці',
        body: 'Менеджер зв’яжеться з вами щодо подальших кроків.',
      };
  }
}

/* ------------------------------------------------ «Покупка Частинами» failures */

/**
 * What monobank's `order_sub_state` on a declined application means for the
 * buyer, and what to do. Codes from the API's own enum (`OrderStateInfo`);
 * anything unlisted — including `ACCOUNT_CLOSED`, which the bank does not
 * document — falls back to «the bank declined».
 */
const PARTS_FAILURE_TEXT: Record<string, string> = {
  CLIENT_NOT_FOUND:
    'Цей номер телефону не зареєстрований у monobank. Оформіть замовлення ще раз і вкажіть номер, до якого прив’язаний ваш monobank.',
  WRONG_CLIENT_APP_VERSION: 'Застаріла версія застосунку monobank. Оновіть застосунок і спробуйте ще раз.',
  EXCEEDED_SUM_LIMIT: 'Сума замовлення перевищує ваш доступний ліміт Покупки Частинами в monobank.',
  EXISTS_OTHER_OPEN_ORDER:
    'У вас є інша незавершена заявка на Покупку Частинами. Підтвердьте або скасуйте її в застосунку monobank і спробуйте ще раз.',
  EXISTS_EXT_OTHER_OPEN_ORDER:
    'У вас є інша незавершена заявка на Покупку Частинами. Підтвердьте або скасуйте її в застосунку monobank і спробуйте ще раз.',
  NOT_ENOUGH_MONEY_FOR_INIT_DEBIT: 'На картці недостатньо коштів для першого платежу.',
  PAY_PARTS_ARE_NOT_ACCEPTABLE: 'З такою кількістю платежів оформити Покупку Частинами не вдалося.',
  CLIENT_PUSH_TIMEOUT: 'Заявку не підтвердили в застосунку monobank протягом 15 хвилин.',
  CLIENT_CONFIRM_TIME_EXPIRED: 'Заявку не підтвердили в застосунку monobank протягом 15 хвилин.',
  CONFIRM_TIME_EXPIRED: 'Час на підтвердження заявки минув.',
  REJECTED_BY_CLIENT: 'Заявку відхилено в застосунку monobank.',
  REJECTED_BY_STORE: 'Заявку скасовано магазином.',
};

const PARTS_FAILURE_FALLBACK =
  'monobank не погодив заявку. Точну причину можна дізнатися в підтримці monobank.';

export function partsFailureText(subState: string | null | undefined): string {
  return subState && Object.hasOwn(PARTS_FAILURE_TEXT, subState)
    ? PARTS_FAILURE_TEXT[subState]!
    : PARTS_FAILURE_FALLBACK;
}

/** Shown under the reason, so a buyer can check themselves before retrying. */
export const PARTS_COMMON_FAILURES = [
  'Номер телефону в замовленні не той, до якого прив’язаний monobank.',
  'Недостатньо доступного ліміту Покупки Частинами — його видно в застосунку monobank, розділ «Кредити».',
  'Є інша незавершена заявка на Покупку Частинами в іншому магазині.',
  'Заявку не підтвердили в застосунку протягом 15 хвилин.',
  'Застаріла версія застосунку monobank.',
] as const;
