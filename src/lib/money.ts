/**
 * Every amount in this codebase is an integer number of kopiykas.
 * Nothing else. If you find yourself writing `19.99`, you are in the wrong unit.
 */
export type Kopiykas = number;

/** Monobank currency code for UAH (ISO 4217 numeric). */
export const UAH = 980;

const formatter = new Intl.NumberFormat('uk-UA', {
  style: 'currency',
  currency: 'UAH',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatterWithCents = new Intl.NumberFormat('uk-UA', {
  style: 'currency',
  currency: 'UAH',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Display only. Whole hryvnias are rendered without a decimal part, since
 * catalog prices are round; anything with kopiykas keeps them.
 */
export function formatPrice(amount: Kopiykas): string {
  const hasCents = amount % 100 !== 0;
  return (hasCents ? formatterWithCents : formatter).format(amount / 100);
}

/** Convenience for seed data and admin input: 1250 UAH -> 125000 kopiykas. */
export function hryvnias(amount: number): Kopiykas {
  return Math.round(amount * 100);
}

export function sum(amounts: readonly Kopiykas[]): Kopiykas {
  return amounts.reduce((total, amount) => total + amount, 0);
}
