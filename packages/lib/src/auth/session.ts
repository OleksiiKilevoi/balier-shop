/**
 * The admin session — a signed cookie, and no server-side session store.
 *
 * The token is `<payload>.<signature>`, both base64url, the signature an
 * HMAC-SHA-256 of the payload under `ADMIN_SESSION_SECRET`. The payload is not
 * encrypted and is not meant to be: it holds an id, an address and an expiry,
 * all of which the person holding the cookie already knows. What the signature
 * buys is that none of the three can be *edited* — a cookie claiming a longer
 * life or somebody else's id fails to verify.
 *
 * WHY NO SESSION TABLE, AND WHAT REPLACED THE HOLE IT LEFT
 * There is still no row per session: verifying is one HMAC, and a table of
 * live sessions is a thing to expire, index and clean up. What that bought
 * originally was a gate that touched neither KV nor Neon — and what it cost was
 * that **a session could not be revoked at all**. A changed password, a
 * switched-off account: both left every cookie already issued working for the
 * rest of its twelve hours.
 *
 * That was the wrong trade for the thing being protected, so as of 2026-08-06
 * the token carries `iat` and every account carries `admin_users.
 * sessions_valid_from`. A token issued before that moment is dead — see
 * `sessionStillValid`, which is the whole mechanism. Revoking is one `UPDATE`
 * of one column, it costs nothing to store, and it revokes *every* session for
 * that account at once, including ones on devices nobody has access to.
 *
 * The price is honest and it is paid in `src/middleware.ts`: the gate now reads
 * the user's row on every request, so the panel spends one Neon round trip
 * (~45 ms) per page view that it did not spend before. For a panel with a
 * handful of accounts on it that is the right way round — and the row is handed
 * to the page in `locals`, so a screen that needs it does not read it twice.
 *
 * Same contract as the rest of `src/lib/`: `verifySession` never throws, and
 * anything it cannot positively confirm comes back `null`. Fail closed.
 */

/**
 * `__Host-` is not decoration: it makes the browser refuse the cookie unless it
 * is `Secure`, path `/` and *without* a `Domain`, which means a subdomain — or
 * anything that manages to write a cookie on one — cannot overwrite the admin
 * session. See `sessionCookieOptions` for the local-development caveat.
 */
export const SESSION_COOKIE = '__Host-admin_session';

/**
 * One working day. Short because nothing can revoke a session early (see the
 * header), long enough that the panel is not asking for a password between one
 * order and the next.
 */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface AdminSession {
  /** `admin_users.id`. */
  sub: string;
  email: string;
  /** When this token was minted. Seconds since the epoch. */
  issuedAt: number;
  /** Seconds since the epoch. */
  expiresAt: number;
}

interface SessionPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Mint a token for a user who has just proved their password.
 * Returns `null` when the secret is unset — an unsigned session is not a
 * session, and the login route reports it as a server error rather than
 * handing out something that would not verify.
 */
export async function signSession(
  secret: string,
  session: { sub: string; email: string },
  ttlSeconds: number = SESSION_TTL_SECONDS,
  now: number = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!secret) return null;

  const payload: SessionPayload = {
    sub: session.sub,
    email: session.email,
    iat: now,
    exp: now + ttlSeconds,
  };

  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(secret, encoded);

  return `${encoded}.${signature}`;
}

/** The identity a token proves, or `null` if it proves nothing. */
export async function verifySession(
  secret: string,
  token: string | null | undefined,
  now: number = Math.floor(Date.now() / 1000),
): Promise<AdminSession | null> {
  // Unconfigured is "deny everyone", never "allow everyone" — the same rule the
  // gate this replaced was built on.
  if (!secret || !token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, signature] = parts as [string, string];

    // Verify before parsing: the payload is attacker-supplied bytes until the
    // signature says otherwise, and there is no reason to interpret it first.
    const expected = await sign(secret, encoded);
    if (!timingSafeEqual(signature, expected)) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    if (typeof payload.email !== 'string' || !payload.email) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    // A token with no `iat` cannot be compared against `sessions_valid_from`,
    // which makes it a token that cannot be revoked — exactly the thing being
    // fixed. Those are the ones minted before 2026-08-06; refusing them signs
    // their holders out once, which is the correct one-off cost.
    if (typeof payload.iat !== 'number' || payload.iat > now) return null;

    return {
      sub: payload.sub,
      email: payload.email,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

/**
 * The revocation check: is this token still one its account recognises?
 *
 * Split out of the gate and kept pure so it can be tested without a database,
 * because it is the piece that decides whether somebody is still signed in.
 * All three parts matter and they answer different questions:
 *
 *   - `isActive` — is this still an account at all. A disabled user is turned
 *     away on their next request rather than at the end of their working day.
 *   - `archivedAt` — has the account been removed from the panel. Checked
 *     independently of `isActive`, because archiving deliberately leaves that
 *     flag alone so «Відновити» can put the account back as it was — which
 *     means an archived row may still be `isActive: true`.
 *   - `sessionsValidFrom` — every token minted before this instant is dead.
 *     Set on a password change and on being switched off, so «I think my
 *     password leaked» has an answer that is true everywhere at once, not just
 *     in the browser doing the asking.
 *
 * Seconds versus milliseconds is the trap here: `iat` is epoch **seconds** and a
 * `Date` is milliseconds, so the column is floored to seconds before the
 * comparison. It is `<` rather than `<=` on purpose — a token minted in the same
 * second as the revocation survives, which is the sign-in that immediately
 * follows a password change, and the alternative is a login that mysteriously
 * does not take.
 */
export function sessionStillValid(
  session: AdminSession,
  user: { isActive: boolean; archivedAt: Date | null; sessionsValidFrom: Date },
): boolean {
  if (!user.isActive || user.archivedAt !== null) return false;
  return session.issuedAt >= Math.floor(user.sessionsValidFrom.getTime() / 1000);
}

/**
 * Cookie attributes, shared by the route that sets the session and the one that
 * clears it — they have to match exactly or the browser keeps the old cookie.
 *
 * `secure` is unconditional, including under `pnpm dev`, and that is not an
 * oversight: `__Host-` requires it, so making it conditional would mean the
 * browser silently *discarding* the cookie locally and the panel looping back
 * to the login form with no error to explain why. It costs nothing, because
 * every browser treats `http://localhost` as a trustworthy origin and accepts
 * `Secure` cookies there. The one arrangement this rules out is developing
 * against a LAN address (`astro dev --host`, opened as `http://192.168.…`),
 * where the cookie would be refused — use a tunnel, or localhost.
 *
 * `sameSite: 'lax'` rather than `'strict'`: the cookie must survive following a
 * link into the panel from elsewhere, and Astro's own origin check already
 * refuses cross-site POSTs, which is the attack `strict` would be covering.
 */
export function sessionCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
  return {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge,
  } as const;
}

/* ----------------------------------------------------------------- internals */

async function sign(secret: string, data: string): Promise<string> {
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

/** Compares two signatures without leaking where they first differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
