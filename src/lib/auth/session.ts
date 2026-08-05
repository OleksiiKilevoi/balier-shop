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
 * WHY NO SESSION TABLE
 * Verifying is one HMAC, so the gate in `src/middleware.ts` costs nothing and
 * touches neither KV nor Neon on a request that is already going to query the
 * database for its own page. The price, and it is a real one: **a session
 * cannot be revoked before it expires.** Signing out clears the cookie in the
 * browser, and a copy taken off that browser first stays valid until `exp`.
 * `SESSION_TTL_SECONDS` is the whole blast radius, which is why it is a working
 * day rather than a month. Changing a password does not end sessions already
 * issued, for the same reason.
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
  /** Seconds since the epoch. */
  expiresAt: number;
}

interface SessionPayload {
  sub: string;
  email: string;
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

    return { sub: payload.sub, email: payload.email, expiresAt: payload.exp };
  } catch {
    return null;
  }
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
