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
 *   - `otp.ts`      — the Telegram sign-in's codes and the webhook secret.
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
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_INTERVAL_SECONDS,
  OTP_TTL_SECONDS,
  TELEGRAM_LINK_TTL_SECONDS,
  constantTimeEqual,
  generateOtpCode,
  generateTelegramLinkCode,
  hashOtp,
  telegramWebhookSecret,
  verifyOtpHash,
} from './otp';

export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  sessionStillValid,
  signSession,
  verifySession,
  type AdminSession,
} from './session';
