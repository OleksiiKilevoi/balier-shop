import { z } from 'zod';
import { hryvnias } from '../money';
import type { Kopiykas } from '../money';

/**
 * **The one place a human-typed amount becomes kopiykas.**
 *
 * Every money field in the admin panel is in hryvnias, because that is what a
 * manager thinks in — «5 000 ₴», never 500 000 — while the hard rule about
 * integer kopiykas is about what gets stored and compared. So the ×100 happens
 * here, at the boundary, and nothing downstream ever sees hryvnias again. A
 * factor-of-100 slip in this file would move every price and threshold in the
 * shop at once, which is why it is one function with its own tests rather than
 * a line repeated per form.
 *
 * Lifted out of `codLimitSchema`, which was the first field to need it and is
 * now one call of it.
 *
 * Kopiykas are not accepted from these fields at all. Catalog prices and limits
 * are round numbers, and a decimal point is far more likely to be a mistyped
 * thousands separator than a real intent to charge 1 849,99 ₴.
 */

/** «5 000», «5 000» (NBSP — what `formatPrice` emits) and «5'000» are one number. */
const SEPARATORS = /[\s '’]/g;

interface Bounds {
  min: number;
  max: number;
  /**
   * The error *key*, not a sentence — the Ukrainian text lives in
   * `~/lib/i18n/admin`, same as every other message in the panel.
   */
  error: string;
}

/** A required whole-hryvnia amount. */
export function wholeHryvniaSchema({ min, max, error }: Bounds) {
  return z
    .string()
    .transform((raw) => raw.replace(SEPARATORS, ''))
    .refine((value) => /^\d+$/.test(value), error)
    .transform(Number)
    .refine((value) => value >= min && value <= max, error)
    .transform(hryvnias);
}

/**
 * The same, but an empty field means «not set» rather than «zero» — which is
 * what `price_override` is: a nullable column whose NULL has a meaning (use the
 * product's base price). Zero would be a free product, so the two cannot be
 * conflated.
 */
export function optionalWholeHryvniaSchema({ min, max, error }: Bounds) {
  return z
    .string()
    .transform((raw) => raw.replace(SEPARATORS, ''))
    .refine((value) => value === '' || /^\d+$/.test(value), error)
    .transform((value): number | null => (value === '' ? null : Number(value)))
    .refine((value) => value === null || (value >= min && value <= max), error)
    .transform((value): Kopiykas | null => (value === null ? null : hryvnias(value)));
}
