/**
 * Reading a Postgres uniqueness violation out of whatever Drizzle threw.
 *
 * Catalog writes let the constraint be the authority on whether a slug or a SKU
 * is free — a `SELECT` before the insert would still race two managers saving at
 * once, and would cost a round trip on every save to catch a case that almost
 * never happens.
 *
 * **The wrapping is the whole reason this file exists.** Drizzle does not
 * rethrow the driver's error; it wraps it in a `DrizzleQueryError` whose message
 * is `Failed query: …`, and the pg error that actually carries `code` and
 * `constraint` sits on `.cause`. Checking the top-level object finds nothing,
 * which turns a refusal a manager could act on («цей slug зайнятий») into a 500.
 * That is exactly what happened the first time this was tested against a real
 * database, so the chain is walked rather than assumed.
 */

/** `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/** Enough to clear the wrapper without following a cycle forever. */
const MAX_DEPTH = 5;

/**
 * The name of the unique constraint that was violated, or `null` if this error
 * is not a uniqueness violation at all. Constraint names come from migration
 * `0000` — `products_slug_unique`, `product_variants_sku_unique`,
 * `categories_slug_unique`.
 */
export function uniqueConstraint(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;

    const { code, constraint, cause } = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };

    if (code === UNIQUE_VIOLATION) {
      // The code is what makes it a uniqueness violation; the name is a bonus,
      // and an empty string is a truthful "violated, but unnamed".
      return typeof constraint === 'string' ? constraint : '';
    }

    current = cause;
  }

  return null;
}
