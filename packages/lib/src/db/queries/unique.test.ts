import { describe, expect, it } from 'vitest';
import { uniqueConstraint } from './unique';

/**
 * This exists because the obvious implementation was wrong, and wrong in a way
 * no type could catch and no unit test would have caught either — it only
 * showed up against a real database.
 *
 * Drizzle wraps the driver's error in a `DrizzleQueryError` (`Failed query: …`)
 * and hangs the pg error, the one carrying `code` and `constraint`, off
 * `.cause`. Checking the thrown object directly finds nothing, so a duplicate
 * slug became a 500 instead of «цей slug уже зайнятий». The fixtures below are
 * the real shapes, taken from the failure.
 */

/** What the driver throws. */
function pgUniqueViolation(constraint: string) {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: '23505',
    constraint,
  });
}

/** What Drizzle rethrows, with the above as its cause. */
function drizzleWrapped(cause: unknown) {
  return Object.assign(new Error('Failed query: insert into "products" ...'), { cause });
}

describe('uniqueConstraint', () => {
  it('reads the constraint through Drizzle’s wrapper', () => {
    expect(uniqueConstraint(drizzleWrapped(pgUniqueViolation('products_slug_unique')))).toBe(
      'products_slug_unique',
    );
    expect(
      uniqueConstraint(drizzleWrapped(pgUniqueViolation('product_variants_sku_unique'))),
    ).toBe('product_variants_sku_unique');
  });

  it('reads it off an unwrapped driver error too', () => {
    expect(uniqueConstraint(pgUniqueViolation('categories_slug_unique'))).toBe(
      'categories_slug_unique',
    );
  });

  it('digs through more than one layer of wrapping', () => {
    const nested = drizzleWrapped(drizzleWrapped(pgUniqueViolation('products_slug_unique')));
    expect(uniqueConstraint(nested)).toBe('products_slug_unique');
  });

  it('returns null for anything that is not a uniqueness violation', () => {
    expect(uniqueConstraint(new Error('connection lost'))).toBeNull();
    // A different Postgres error — foreign key violation.
    expect(uniqueConstraint(Object.assign(new Error('fk'), { code: '23503' }))).toBeNull();
    expect(uniqueConstraint(drizzleWrapped(new Error('timeout')))).toBeNull();
    expect(uniqueConstraint(null)).toBeNull();
    expect(uniqueConstraint('23505')).toBeNull();
    expect(uniqueConstraint(undefined)).toBeNull();
  });

  it('reports an unnamed violation as violated rather than as not-a-violation', () => {
    // The code is what makes it a conflict; the name only decides which message.
    expect(uniqueConstraint(Object.assign(new Error('dup'), { code: '23505' }))).toBe('');
  });

  it('does not hang on an error that causes itself', () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(uniqueConstraint(loop)).toBeNull();
  });
});
