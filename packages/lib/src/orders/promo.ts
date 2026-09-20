import type { Kopiykas } from '../money';

/**
 * The e-mail promo: one code per address, one order per code
 * (`~/lib/db/queries/promo.ts` owns the rows, `./create.ts` the redemption).
 * Pure helpers here so the arithmetic and the code shape have tests.
 */

/** Kopiykas off `itemsTotal` at `percent`, rounded to the kopiyka, never more than the total. */
export function discountFor(itemsTotal: Kopiykas, percent: number): Kopiykas {
  if (percent <= 0 || itemsTotal <= 0) return 0;
  return Math.min(itemsTotal, Math.round((itemsTotal * percent) / 100));
}

/**
 * `BALIER-XXXXX`: five characters from an alphabet without 0/O/1/I, so a code
 * read out loud or retyped from a phone screen survives. ~28M combinations —
 * enough that a collision on the unique column is a retry, not a design.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PROMO_CODE_PATTERN = /^BALIER-[A-Z0-9]{5}$/;

export function generatePromoCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let tail = '';
  for (const byte of bytes) tail += ALPHABET[byte % ALPHABET.length];
  return `BALIER-${tail}`;
}

/** What the checkout field holds, as the code was printed: trimmed, upper-cased. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}
