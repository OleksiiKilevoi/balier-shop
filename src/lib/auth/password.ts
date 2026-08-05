/**
 * Password hashing for the admin panel, on Web Crypto alone.
 *
 * PBKDF2-HMAC-SHA-256 — not because it is the best KDF (bcrypt, scrypt and
 * argon2 all resist GPUs better), but because it is the only one the Workers
 * runtime implements natively. The alternatives arrive as WebAssembly, which
 * means shipping a blob into a bundle that has to stay auditable, and a slow
 * cold path in front of the one screen an operator uses every day. The trade is
 * accepted deliberately: the iteration count below is the compensation, and the
 * accounts this protects number in the single digits.
 *
 * The stored string is self-describing:
 *
 *   pbkdf2-sha256$100000$<salt base64>$<derived key base64>
 *
 * so the cost can be raised later without invalidating a single existing hash —
 * `verifyPassword` reads the iterations out of the row it is checking, and
 * `needsRehash` says when a row is behind. Nothing here is reversible, and
 * nothing here throws: a malformed stored value is a failed login, not a 500.
 */

const SCHEME = 'pbkdf2-sha256';

/**
 * **The runtime's ceiling, not ours.** The deployed Workers runtime refuses
 * PBKDF2 above one hundred thousand iterations outright —
 *
 *   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
 *   supported (requested 210000).
 *
 * — a deliberate DoS guard in workerd, and there is no flag that lifts it.
 *
 * This shipped broken because **nothing local enforces it**: Node (so `pnpm
 * test` and `scripts/admin-user.ts`), Vite's dev server (so `pnpm dev`) and
 * even `wrangler dev`'s own workerd all derive at 210 000 without complaint —
 * checked, not assumed. Only the deployed Worker throws. So a count above this
 * is refused *here*, in code that runs everywhere, rather than left to a
 * runtime that only objects in the one place we cannot iterate quickly.
 *
 * The cost of the cap is real and worth stating plainly: 100 000 is under
 * OWASP's 600 000 for PBKDF2-HMAC-SHA-256, so the compensation this module's
 * header claims for choosing PBKDF2 is weaker than it reads. What buys it back
 * is chaining several capped derivations into one hash — deliberately not done
 * here, because it multiplies the CPU every login spends and this fix's job was
 * to make the panel openable again.
 */
export const MAX_ITERATIONS = 100_000;

/**
 * As expensive as the runtime permits (see `MAX_ITERATIONS`). Costs on the
 * order of a hundred milliseconds of Worker CPU per login, which is invisible
 * on a form submit and enough to make offline guessing against a leaked row
 * unattractive rather than trivial.
 */
export const DEFAULT_ITERATIONS = MAX_ITERATIONS;

const SALT_BYTES = 16;
const KEY_BITS = 256;

/**
 * Hash a password for storage. A fresh random salt every time, by design.
 *
 * Throws above `MAX_ITERATIONS` rather than clamping: a hash written at a cost
 * the deployed runtime cannot re-derive is one nobody can ever log in with, and
 * the caller (`scripts/admin-user.ts`, run on Node, where the ceiling does not
 * exist) is exactly the place that would never find out.
 */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new RangeError(
      `PBKDF2 iterations must be between 1 and ${MAX_ITERATIONS} (got ${iterations}).`,
    );
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveKey(password, salt, iterations);

  return `${SCHEME}$${iterations}$${toBase64(salt)}$${toBase64(derived)}`;
}

/**
 * Check a password against a stored hash. `false` for every failure —
 * wrong password, unknown scheme, truncated field, garbage base64 — because
 * the caller has exactly one correct response to all of them.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parsed = parse(stored);
    if (!parsed) return false;

    const derived = await deriveKey(password, parsed.salt, parsed.iterations);
    return timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/**
 * True when a stored hash was made with a weaker setting than we now use — the
 * signal to re-hash on the next successful login, which is the only moment the
 * plaintext exists to do it with. Also true for anything unparseable, so a row
 * written by some future scheme is replaced rather than left behind.
 *
 * A row above `MAX_ITERATIONS` counts as unparseable, and re-hashing will never
 * reach it: the login that would trigger it cannot succeed in the first place.
 * Those rows are reset with `pnpm admin:user password`, not repaired here.
 */
export function needsRehash(stored: string, iterations: number = DEFAULT_ITERATIONS): boolean {
  const parsed = parse(stored);
  return !parsed || parsed.iterations < iterations;
}

/**
 * Burn one KDF run and discard it. Used when a login names an address that has
 * no row: without it the "no such user" answer comes back in a millisecond
 * while a real address takes the full derivation, and that difference alone
 * tells an attacker which addresses are admins.
 *
 * Swallows its own failures, and that is the point rather than laziness: this
 * is the module's only call site with no result to report, so an exception here
 * escapes into the login page and becomes a 500 in front of a person who simply
 * mistyped their address. It did — the iteration ceiling threw here while
 * `verifyPassword`'s catch quietly absorbed the identical throw next door, so a
 * wrong address 500'd and a right password came back «wrong password».
 */
export async function equalizeVerifyTiming(password: string): Promise<void> {
  try {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    await deriveKey(password, salt, DEFAULT_ITERATIONS);
  } catch {
    /* Nothing to report: the work was the whole product. */
  }
}

/**
 * Addresses are compared case-insensitively and stored lower-cased, so
 * `Anna@Balier.ua` and `anna@balier.ua` cannot become two admins. The only
 * writer and the only reader of `admin_users.email` both go through here.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/* ----------------------------------------------------------------- internals */

interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function parse(stored: string): ParsedHash | null {
  const parts = stored?.split('$');
  if (parts?.length !== 4) return null;

  const [scheme, iterationsPart, saltPart, hashPart] = parts as [string, string, string, string];
  if (scheme !== SCHEME) return null;

  const iterations = Number(iterationsPart);
  if (!Number.isInteger(iterations) || iterations < 1) return null;
  // Above the runtime's ceiling the derivation would throw rather than return a
  // wrong answer, and `verifyPassword`'s catch would turn that into a silent
  // «wrong password» for a password that is right. Rows written before the cap
  // was known are unusable, so say so here — one branch, and `needsRehash`
  // reports them as needing replacement for free.
  if (iterations > MAX_ITERATIONS) return null;

  const salt = fromBase64(saltPart);
  const hash = fromBase64(hashPart);
  if (!salt || !hash || salt.length === 0 || hash.length === 0) return null;

  return { iterations, salt, hash };
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );

  return new Uint8Array(bits);
}

/**
 * Compares in a time that depends on the length of the inputs but not on where
 * they first differ. `crypto.subtle.timingSafeEqual` is not in the Workers
 * runtime, and `a === b` on the base64 strings would leak the position of the
 * first wrong byte to anyone able to time enough attempts.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
