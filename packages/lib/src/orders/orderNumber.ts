/**
 * Human-readable order numbers: `B<YYMMDD>-<5 random chars>`, e.g. `B260804-K3F9Q`.
 * Also sent to Monobank as `merchantPaymInfo.reference`, and what a customer
 * reads back on `/checkout/success` or in a support message — short and
 * date-anchored beats a UUID for both.
 *
 * Uniqueness is enforced by the `orders.order_number` unique constraint, not
 * here: the create-order path retries with a fresh number on conflict, which
 * this alphabet (32^5 ≈ 33M combinations per day) makes vanishingly rare.
 */

// No 0/O or 1/I — nothing a customer reads over the phone should be ambiguous.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SUFFIX_LENGTH = 5;

export function generateOrderNumber(now: Date = new Date()): string {
  const datePart = now.toISOString().slice(2, 10).replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH));
  const suffix = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `B${datePart}-${suffix}`;
}
