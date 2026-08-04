import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createAccessVerifier, extractAccessToken, normalizeTeamDomain } from './index';

/**
 * The keypair is generated here and the certs endpoint is stubbed, which means
 * these tests constrain the *logic* — claim checks, algorithm pinning, expiry —
 * and not the wire format. `docs/plans/roadmap.md` records why that distinction
 * matters: a self-signed fixture cannot validate a wire format, and the Monobank
 * pubkey bug hid behind exactly this kind of stub for six green tests.
 *
 * The shape below (`keys[]` of RSA JWKs carrying `kid`) is the one Cloudflare
 * documents for `/cdn-cgi/access/certs`, but it has NOT been checked against a
 * live endpoint — no Zero Trust team exists on the account yet. The first real
 * Access login is what confirms it; see `docs/STATE.md`.
 */

const TEAM_DOMAIN = 'https://balier.cloudflareaccess.com';
const AUD = 'a1b2c3d4e5f6';
const KID = 'test-key-1';
const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const NOW = 1_800_000_000;

let privateKey: CryptoKey;
// `kid` is not on lib.dom's `JsonWebKey`, but it is what the certs endpoint
// keys the set by — the verifier reads it off the same widened shape.
let jwk: JsonWebKey & { kid: string };
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const params = { ...ALGORITHM, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
  const pair = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: KID };

  const other = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
  otherPrivateKey = other.privateKey;
});

function base64Url(input: string | ArrayBuffer): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function issueToken(
  claims: Record<string, unknown> = {},
  options: { kid?: string; key?: CryptoKey } = {},
): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: 'RS256', kid: options.kid ?? KID }));
  const payload = base64Url(
    JSON.stringify({
      iss: TEAM_DOMAIN,
      aud: [AUD],
      exp: NOW + 3600,
      iat: NOW,
      sub: 'user-1',
      email: 'admin@balier.ua',
      ...claims,
    }),
  );
  const signature = await crypto.subtle.sign(
    ALGORITHM,
    options.key ?? privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(signature)}`;
}

/** The documented certs response: current and rotated keys, JWK format. */
function stubCerts() {
  return vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));
}

function verifier(overrides: { aud?: string; teamDomain?: string; fetch?: typeof fetch } = {}) {
  return createAccessVerifier(
    { teamDomain: overrides.teamDomain ?? TEAM_DOMAIN, aud: overrides.aud ?? AUD },
    { fetch: overrides.fetch ?? (stubCerts() as unknown as typeof fetch), now: () => NOW },
  );
}

describe('createAccessVerifier', () => {
  it('accepts a token signed by the team key for this application', async () => {
    const identity = await verifier().verify(await issueToken());

    expect(identity).toEqual({ email: 'admin@balier.ua', sub: 'user-1', expiresAt: NOW + 3600 });
  });

  it('accepts a string `aud` as well as an array', async () => {
    const identity = await verifier().verify(await issueToken({ aud: AUD }));

    expect(identity?.email).toBe('admin@balier.ua');
  });

  it('rejects a token minted for a different Access application', async () => {
    const identity = await verifier().verify(await issueToken({ aud: ['someone-elses-app'] }));

    expect(identity).toBeNull();
  });

  it('rejects a token from a different team', async () => {
    const identity = await verifier().verify(
      await issueToken({ iss: 'https://attacker.cloudflareaccess.com' }),
    );

    expect(identity).toBeNull();
  });

  it('rejects an expired token, and one that is not valid yet', async () => {
    const access = verifier();

    expect(await access.verify(await issueToken({ exp: NOW - 1 }))).toBeNull();
    expect(await access.verify(await issueToken({ nbf: NOW + 60 }))).toBeNull();
  });

  it('rejects a token with no expiry at all', async () => {
    const identity = await verifier().verify(await issueToken({ exp: undefined }));

    expect(identity).toBeNull();
  });

  it('rejects a token whose payload was edited after signing', async () => {
    const [header, , signature] = (await issueToken()).split('.');
    const forged = base64Url(
      JSON.stringify({ iss: TEAM_DOMAIN, aud: [AUD], exp: NOW + 3600, email: 'attacker@evil.com' }),
    );

    expect(await verifier().verify(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it('rejects a token signed by a key the team never published', async () => {
    const identity = await verifier().verify(await issueToken({}, { key: otherPrivateKey }));

    expect(identity).toBeNull();
  });

  it('rejects an unsigned `alg: none` token without fetching a key', async () => {
    const fetchImpl = stubCerts();
    const header = base64Url(JSON.stringify({ alg: 'none', kid: KID }));
    const payload = base64Url(JSON.stringify({ iss: TEAM_DOMAIN, aud: [AUD], exp: NOW + 3600 }));

    const identity = await verifier({ fetch: fetchImpl as unknown as typeof fetch }).verify(
      `${header}.${payload}.`,
    );

    expect(identity).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a `kid` that is not in the published key set', async () => {
    const identity = await verifier().verify(await issueToken({}, { kid: 'rotated-away' }));

    expect(identity).toBeNull();
  });

  it('denies everything when the application is not configured yet', async () => {
    const token = await issueToken();

    expect(await verifier({ aud: '' }).verify(token)).toBeNull();
    expect(await verifier({ teamDomain: '' }).verify(token)).toBeNull();
  });

  it('denies rather than throws when the certs endpoint is unreachable', async () => {
    const unreachable = vi.fn(async () => {
      throw new Error('network down');
    });
    const failing = vi.fn(async () => new Response('nope', { status: 500 }));
    const token = await issueToken();

    await expect(
      verifier({ fetch: unreachable as unknown as typeof fetch }).verify(token),
    ).resolves.toBeNull();
    await expect(
      verifier({ fetch: failing as unknown as typeof fetch }).verify(token),
    ).resolves.toBeNull();
  });

  it('denies a missing or malformed token', async () => {
    const access = verifier();

    expect(await access.verify(null)).toBeNull();
    expect(await access.verify('')).toBeNull();
    expect(await access.verify('not-a-jwt')).toBeNull();
  });
});

describe('extractAccessToken', () => {
  const request = (headers: Record<string, string>) => new Request('https://balier.ua/admin', { headers });

  it('prefers the Cf-Access-Jwt-Assertion header', () => {
    expect(
      extractAccessToken(
        request({ 'cf-access-jwt-assertion': 'header-token', cookie: 'CF_Authorization=cookie-token' }),
      ),
    ).toBe('header-token');
  });

  it('falls back to the CF_Authorization cookie', () => {
    expect(extractAccessToken(request({ cookie: 'foo=bar; CF_Authorization=cookie-token' }))).toBe(
      'cookie-token',
    );
  });

  it('returns null when neither is present', () => {
    expect(extractAccessToken(request({}))).toBeNull();
    expect(extractAccessToken(request({ cookie: 'foo=bar' }))).toBeNull();
  });
});

describe('normalizeTeamDomain', () => {
  it('accepts a bare team name, a hostname or a full URL', () => {
    expect(normalizeTeamDomain('balier')).toBe(TEAM_DOMAIN);
    expect(normalizeTeamDomain('balier.cloudflareaccess.com')).toBe(TEAM_DOMAIN);
    expect(normalizeTeamDomain('https://balier.cloudflareaccess.com/')).toBe(TEAM_DOMAIN);
  });

  it('returns null for an unset value', () => {
    expect(normalizeTeamDomain('')).toBeNull();
    expect(normalizeTeamDomain('   ')).toBeNull();
  });
});
