import { describe, expect, it } from 'vitest';
import {
  SESSION_TTL_SECONDS,
  sessionStillValid,
  signSession,
  verifySession,
} from './session';
import type { AdminSession } from './session';

const SECRET = 'a-test-signing-secret-at-least-32-bytes-long';
const OTHER_SECRET = 'a-different-signing-secret-entirely!!';
const NOW = 1_800_000_000;

const identity = { sub: '2f1c8f6e-0000-4000-8000-000000000001', email: 'anna@balier.ua' };

describe('signSession', () => {
  it('round-trips the identity and stamps the expiry from the TTL', async () => {
    const token = await signSession(SECRET, identity, SESSION_TTL_SECONDS, NOW);
    const session = await verifySession(SECRET, token, NOW);

    expect(session).toEqual({
      sub: identity.sub,
      email: identity.email,
      issuedAt: NOW,
      expiresAt: NOW + SESSION_TTL_SECONDS,
    });
  });

  it('refuses to mint anything without a secret', async () => {
    // An unsigned session is not a session — the login route reports this as a
    // server error rather than handing out a token that would never verify.
    expect(await signSession('', identity)).toBeNull();
  });
});

describe('verifySession', () => {
  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(OTHER_SECRET, identity, SESSION_TTL_SECONDS, NOW);
    expect(await verifySession(SECRET, token, NOW)).toBeNull();
  });

  it('rejects an edited payload — the whole point of signing it', async () => {
    const token = (await signSession(SECRET, identity, SESSION_TTL_SECONDS, NOW)) as string;
    const [, signature] = token.split('.');

    // Somebody else's id, a longer life, and a different address: each is a
    // fresh payload, and none of them carries a signature that matches.
    const forged = btoa(
      JSON.stringify({ sub: 'somebody-else', email: 'attacker@example.com', exp: NOW + 999_999 }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(await verifySession(SECRET, `${forged}.${signature}`, NOW)).toBeNull();
  });

  it('rejects an expired token, exactly at the boundary', async () => {
    const token = await signSession(SECRET, identity, 60, NOW);

    expect(await verifySession(SECRET, token, NOW + 59)).not.toBeNull();
    expect(await verifySession(SECRET, token, NOW + 60)).toBeNull();
    expect(await verifySession(SECRET, token, NOW + 61)).toBeNull();
  });

  it('denies everything when the secret is unset, rather than allowing it', async () => {
    const token = await signSession(SECRET, identity, SESSION_TTL_SECONDS, NOW);
    expect(await verifySession('', token, NOW)).toBeNull();
  });

  it('says no to anything malformed instead of throwing', async () => {
    const token = (await signSession(SECRET, identity, SESSION_TTL_SECONDS, NOW)) as string;
    const [payload, signature] = token.split('.');

    const cases: (string | null | undefined)[] = [
      null,
      undefined,
      '',
      'not-a-token',
      payload as string,
      `${payload}.`,
      `.${signature}`,
      `${payload}.${signature}.extra`,
      `${payload}.${signature}x`,
      // Valid base64url that is not JSON, carrying no signature at all.
      'bm90IGpzb24.bm90IGpzb24',
    ];

    for (const value of cases) {
      expect(await verifySession(SECRET, value, NOW)).toBeNull();
    }
  });

  it('rejects a well-signed payload that is missing its claims', async () => {
    // Signed by us, so the signature is genuine — the claim checks are what
    // stop a token with no subject from becoming a session for nobody. Each
    // case carries every *other* claim, so it fails for the reason it names.
    for (const claims of [
      { email: identity.email, exp: NOW + 60, iat: NOW },
      { sub: identity.sub, exp: NOW + 60, iat: NOW },
      { sub: identity.sub, email: identity.email, iat: NOW },
      { sub: '', email: identity.email, exp: NOW + 60, iat: NOW },
      { sub: identity.sub, email: identity.email, exp: 'soon', iat: NOW },
    ]) {
      const token = await signPayload(claims);
      expect(await verifySession(SECRET, token, NOW)).toBeNull();
    }
  });

  it('rejects a token with no issued-at, because nothing can revoke it', async () => {
    // The shape every token had before 2026-08-06: verifiable, unexpired, and
    // impossible to compare against `sessions_valid_from`. Refusing it signs
    // those holders out exactly once.
    const legacy = await signPayload({ sub: identity.sub, email: identity.email, exp: NOW + 60 });
    expect(await verifySession(SECRET, legacy, NOW)).toBeNull();
  });

  it('rejects a token minted in the future', async () => {
    // A clock that ran ahead, or a payload edited to dodge a revocation by
    // claiming to be newer than it is. The signature makes the second unlikely;
    // the check costs one comparison.
    const ahead = await signPayload({
      sub: identity.sub,
      email: identity.email,
      exp: NOW + 600,
      iat: NOW + 60,
    });
    expect(await verifySession(SECRET, ahead, NOW)).toBeNull();
  });
});

/**
 * Revocation. The signature says the token is ours and unedited; this says the
 * account still honours it. It is the difference between «signed out» meaning
 * «this browser forgot» and meaning «that session is over, everywhere».
 */
describe('sessionStillValid', () => {
  const session: AdminSession = {
    sub: identity.sub,
    email: identity.email,
    issuedAt: NOW,
    expiresAt: NOW + SESSION_TTL_SECONDS,
  };

  /** `sessions_valid_from` as a `Date`, from epoch seconds. */
  const validFrom = (seconds: number) => new Date(seconds * 1000);

  it('keeps a token minted after the account was last revoked', () => {
    expect(sessionStillValid(session, { isActive: true, sessionsValidFrom: validFrom(NOW - 60) })).toBe(
      true,
    );
  });

  it('refuses every token minted before the revocation', () => {
    expect(sessionStillValid(session, { isActive: true, sessionsValidFrom: validFrom(NOW + 1) })).toBe(
      false,
    );
  });

  it('keeps a token minted in the same second as the revocation', () => {
    // The sign-in that immediately follows a password change: the revocation
    // and the fresh token land in the same second, and treating that as revoked
    // would make the new password fail to take.
    expect(sessionStillValid(session, { isActive: true, sessionsValidFrom: validFrom(NOW) })).toBe(
      true,
    );
  });

  it('ignores the sub-second part of the column, which is milliseconds', () => {
    // `iat` is epoch seconds and a `Date` is milliseconds. Compared naively,
    // a revocation at NOW.500 would kill a token minted at NOW — including the
    // one just issued to replace it.
    const withMillis = new Date(NOW * 1000 + 500);
    expect(sessionStillValid(session, { isActive: true, sessionsValidFrom: withMillis })).toBe(true);
  });

  it('refuses a disabled account whatever the timestamps say', () => {
    expect(
      sessionStillValid(session, { isActive: false, sessionsValidFrom: validFrom(NOW - 3600) }),
    ).toBe(false);
  });
});

/**
 * Signs an arbitrary object the way `signSession` signs its own payload, so a
 * test can produce a token that is genuinely signed but wrongly shaped —
 * something no public function will make.
 */
async function signPayload(claims: Record<string, unknown>): Promise<string> {
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));

  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
