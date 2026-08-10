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
