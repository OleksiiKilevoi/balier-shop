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
 *   pbkdf2-sha256$210000$<salt base64>$<derived key base64>
 *
 * so the cost can be raised later without invalidating a single existing hash —
 * `verifyPassword` reads the iterations out of the row it is checking, and
 * `needsRehash` says when a row is behind. Nothing here is reversible, and
 * nothing here throws: a malformed stored value is a failed login, not a 500.
 */

const SCHEME = 'pbkdf2-sha256';

/**
 * OWASP's floor for PBKDF2-HMAC-SHA-256. Costs a few hundred milliseconds of
 * Worker CPU per login, which is invisible on a form submit and expensive
 * enough to make offline guessing against a leaked row unattractive.
 */
export const DEFAULT_ITERATIONS = 210_000;

const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Hash a password for storage. A fresh random salt every time, by design. */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
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
 */
export async function equalizeVerifyTiming(password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  await deriveKey(password, salt, DEFAULT_ITERATIONS);
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
