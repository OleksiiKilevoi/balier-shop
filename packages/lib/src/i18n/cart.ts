import type { CartNotice } from '../cart';
import { pluralUk } from './plural';

/**
 * The cart's dynamic Ukrainian text.
 *
 * These strings are built in the browser from an API response, so unlike the
 * copy in a `.astro` page they cannot live in markup. The server sends reason
 * codes; the wording lives here, in one place, ready for the translation tables
 * when i18n lands in Phase 6.
 */

/** «2 товари» — the header badge's accessible name. */
export function cartCountLabel(count: number): string {
  if (count === 0) return 'Кошик порожній';

  const noun = pluralUk(count, { one: 'товар', few: 'товари', many: 'товарів' });
  return `Кошик, ${count} ${noun}`;
}

/**
 * Why a line changed when the server revalidated it. Phrased as something that
 * has already happened, because it has — the cart on screen is the corrected
 * one, and offering to undo it would only offer to buy what is not there.
 */
export function cartNoticeText(notice: CartNotice): string {
  const name = notice.title ? `«${notice.title}»` : 'Один із товарів';

  switch (notice.reason) {
    case 'unavailable':
      return `${name} більше не продається — ми прибрали його з кошика.`;
    case 'out_of_stock':
      return `${name} закінчився — ми прибрали його з кошика.`;
    // «шт.» rather than an inflected noun: the count is a running number the
    // stepper can land anywhere on, and the abbreviation is both idiomatic in
    // Ukrainian retail and immune to the 1/2–4/5+ agreement it would otherwise need.
    case 'reduced':
      return `${name}: у наявності лише ${notice.quantity} шт. — кількість зменшено.`;
  }
}
