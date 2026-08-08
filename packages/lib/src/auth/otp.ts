/**
 * The Telegram sign-in: one-time codes, deep-link handshake codes, and the
 * webhook's shared secret. Pure Web Crypto, same as the rest of `~/auth` — no
 * Node APIs, so every function runs identically in the Worker, in `tsx`
 * scripts and in tests.
 *
 * WHAT PROTECTS A SIX-DIGIT CODE
 * Not the hash. A million possibilities fall to an offline guess in a blink,
 * whatever they are hashed with — so the HMAC under `ADMIN_SESSION_SECRET` is
 * hygiene (a database read alone shows no live code), not the defence. The
 * defence is that guessing is only possible *online* and the row refuses it:
 * five attempts per code (`claimOtpAttempt`, counted in SQL), five minutes of
 * life, one use. Five guesses out of a million is where that lands.
 */

/** Six digits: what every authenticator has taught people to expect. */
export const OTP_LENGTH = 6;
/** Long enough to open Telegram on a phone, short enough to be worthless later. */
export const OTP_TTL_SECONDS = 5 * 60;
/** Wrong answers one code survives. The sixth needs a fresh code — and a resend wait. */
export const OTP_MAX_ATTEMPTS = 5;
/**
 * A second code inside this window is not sent. Protects the bot from being
 * somebody's free notification cannon as much as it protects the account.
 */
export const OTP_RESEND_INTERVAL_SECONDS = 60;

/**
 * A pending deep link is an invitation to bind a chat to an account, so it
 * lives longer than a code — long enough to install Telegram if it comes to
 * that — but not indefinitely: a link pasted into the wrong chat should be a
 * near-miss, not a standing offer.
 */
export const TELEGRAM_LINK_TTL_SECONDS = 15 * 60;

/**
 * A uniform six-digit string. Rejection sampling rather than `% 1_000_000`:
 * 2^32 is not a multiple of a million, so the plain modulo would make low
 * codes measurably more likely. The loop retries on the sliver of range that
 * causes it (~0.02% of draws), so it terminates immediately in practice.
 */
export function generateOtpCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);

  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0]!;
  } while (value >= limit);

  return String(value % 1_000_000).padStart(OTP_LENGTH, '0');
}

/**
 * The `start=` payload for `t.me/<bot>?start=<code>`. Telegram allows 64 chars
 * of `A-Za-z0-9_-`, which is exactly base64url — 24 random bytes make 32
 * characters, unguessable in a way a six-digit code deliberately is not: this
 * one arrives over a URL and is the *whole* proof, so it carries real entropy.
 */
export function generateTelegramLinkCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * What `admin_users.otp_hash` stores. Keyed under `ADMIN_SESSION_SECRET` and
 * bound to the user id, so a hash lifted from one row proves nothing about
 * another row's code even when both people were sent the same six digits.
 */
export async function hashOtp(secret: string, userId: string, code: string): Promise<string> {
  return hmacBase64Url(secret, `otp:${userId}:${code}`);
}

/** Constant-time, like the session signature check it sits beside. */
export async function verifyOtpHash(
  secret: string,
  userId: string,
  code: string,
  storedHash: string,
): Promise<boolean> {
  return constantTimeEqual(await hashOtp(secret, userId, code), storedHash);
}

/**
 * The `secret_token` Telegram echoes back in `X-Telegram-Bot-Api-Secret-Token`
 * on every webhook delivery — how the handler knows a POST came through
 * Telegram rather than from anyone who found the URL.
 *
 * Derived from the bot token rather than provisioned as its own secret, on
 * purpose: the Worker and `scripts/telegram-webhook.ts` (which registers the
 * webhook and must hand Telegram the same value) both already hold
 * `TELEGRAM_BOT_TOKEN`, and a derived value cannot drift between them or be
 * forgotten during a deploy. Base64url keeps it inside Telegram's allowed
 * `A-Za-z0-9_-` alphabet.
 */
export async function telegramWebhookSecret(botToken: string): Promise<string> {
  return hmacBase64Url(botToken, 'balier-admin-telegram-webhook');
}

/**
 * Comparison that does not leak where two strings first differ. Exported for
 * the webhook route's `secret_token` check; `~/auth/session` keeps its own
 * private copy for the same job on cookie signatures.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ----------------------------------------------------------------- internals */

async function hmacBase64Url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(data) as BufferSource,
  );

  return toBase64Url(new Uint8Array(signature));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
