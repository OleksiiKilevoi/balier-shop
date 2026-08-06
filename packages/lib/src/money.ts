/**
 * Every amount in this codebase is an integer number of kopiykas.
 * Nothing else. If you find yourself writing `19.99`, you are in the wrong unit.
 */
export type Kopiykas = number;

/** Monobank currency code for UAH (ISO 4217 numeric). */
export const UAH = 980;

/**
 * The mockups price everything in `₴`, and `style: 'currency'` does not reliably
 * produce it: workerd's ICU renders UAH in uk-UA as `грн`, Node's as `₴`. The
 * symbol would then differ between the dev server and production, which is not
 * something a price should do. So the number is formatted (grouping separators
 * are stable) and the symbol is appended by us.
 */
const UAH_SYMBOL = '₴';

/** U+00A0 — a price must never wrap away from its symbol in a narrow card. */
const NBSP = ' ';

const formatter = new Intl.NumberFormat('uk-UA', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatterWithCents = new Intl.NumberFormat('uk-UA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Display only. Whole hryvnias are rendered without a decimal part, since
 * catalog prices are round; anything with kopiykas keeps them.
 */
export function formatPrice(amount: Kopiykas): string {
  const hasCents = amount % 100 !== 0;
  const number = (hasCents ? formatterWithCents : formatter).format(amount / 100);
  return `${number}${NBSP}${UAH_SYMBOL}`;
}

/** Convenience for seed data and admin input: 1250 UAH -> 125000 kopiykas. */
export function hryvnias(amount: number): Kopiykas {
  return Math.round(amount * 100);
}

export function sum(amounts: readonly Kopiykas[]): Kopiykas {
  return amounts.reduce((total, amount) => total + amount, 0);
}
