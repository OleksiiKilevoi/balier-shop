/**
 * The admin panel's own authentication: an email/password form, a PBKDF2 hash
 * in `admin_users`, and a signed session cookie. Nothing here depends on
 * Cloudflare Access, on Zero Trust, or on any other edge product — which is the
 * point. The panel is meant to be lifted into the next business, and an account
 * on somebody's dashboard does not travel with it.
 *
 * Split by responsibility:
 *   - `password.ts` — hashing, verification, and the email normalisation both
 *     sides of the lookup share.
 *   - `session.ts`  — minting and verifying the cookie the gate reads.
 */

export {
  DEFAULT_ITERATIONS,
  equalizeVerifyTiming,
  hashPassword,
  needsRehash,
  normalizeEmail,
  verifyPassword,
} from './password';

export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
  type AdminSession,
} from './session';
