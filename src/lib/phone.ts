/**
 * `/checkout`'s phone field mask. The visible input only ever holds the 9
 * local digits after +380 — the country code is a fixed prefix in the UI, so
 * these functions never see or emit it, matching `customerPhoneSchema`
 * (`src/lib/validation/checkout.ts`) which is what actually needs the full
 * `+380XXXXXXXXX` form.
 */

const LOCAL_DIGITS = 9;

/**
 * Strips a pasted/autofilled number down to its 9 local digits, regardless
 * of whether it arrived as `0XXXXXXXXX`, `380XXXXXXXXX` or `+380XXXXXXXXX`.
 */
export function phoneDigitsFromInput(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('380')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, LOCAL_DIGITS);
}

/** `"501234567"` -> `"50 123 45 67"`. */
export function formatPhoneDigits(digits: string): string {
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)]
    .filter(Boolean)
    .join(' ');
}

export function isCompletePhoneDigits(digits: string): boolean {
  return digits.length === LOCAL_DIGITS;
}
