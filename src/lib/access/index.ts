/**
 * Cloudflare Access JWT verification — the server-side half of the admin gate.
 * https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 *
 * Access authenticates at the edge and forwards the request with a signed JWT in
 * `Cf-Access-Jwt-Assertion`. `docs/CONVENTIONS.md` requires this second check
 * inside the app, and the reason is not paranoia: edge configuration is one
 * dashboard toggle away from being wrong, and a Worker is reachable on its
 * `workers.dev` URL where no Access policy applies at all. Verifying the
 * signature here means the application is safe even when the edge is not.
 *
 * Contract, matching the other adapters in `src/lib/`: `verify()` never throws.
 * Anything it cannot positively confirm — malformed token, unknown key, a certs
 * endpoint that is down — comes back `null`, which the caller treats as "deny".
 * Fail closed.
 */

export interface AccessConfig {
  /**
   * The Zero Trust team domain. Accepts `balier`,
   * `balier.cloudflareaccess.com` or the full `https://…` URL — all three are
   * normalised to the issuer Access actually puts in the `iss` claim.
   */
  teamDomain: string;
  /** The Access application's Application Audience (AUD) tag. */
  aud: string;
}

export interface AccessIdentity {
  /** The authenticated user. Absent for service-token access. */
  email: string | null;
  /** Access's stable user id (`sub`), empty for service tokens. */
  sub: string;
  /** `exp`, seconds since the epoch. */
  expiresAt: number;
}

export interface AccessVerifier {
  verify(token: string | null): Promise<AccessIdentity | null>;
}

interface AccessDeps {
  /** Injected in tests; production passes the global. */
  fetch?: typeof fetch;
  /** Seconds since the epoch. Injected so expiry can be tested. */
  now?: () => number;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  sub?: string;
  email?: string;
}

/** Access signs with RS256 only. */
const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

export function createAccessVerifier(config: AccessConfig, deps: AccessDeps = {}): AccessVerifier {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const issuer = normalizeTeamDomain(config.teamDomain);

  return {
    async verify(token: string | null): Promise<AccessIdentity | null> {
      // Unconfigured is not "allow everyone" — it is "deny everyone". Until an
      // Access application exists, `/admin` answers 403 to every request.
      if (!token || !issuer || !config.aud) return null;

      try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

        const header = JSON.parse(decodeSegment(headerPart)) as JwtHeader;
        // Never take the algorithm from the token itself. A token asking for
        // `none`, or for an HMAC that would let its own key double as the
        // secret, is a forgery attempt — reject it before touching a key.
        if (header.alg !== 'RS256' || !header.kid) return null;

        const jwk = await fetchSigningKey(fetchImpl, issuer, header.kid);
        if (!jwk) return null;

        const key = await crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['verify']);
        const signed = await crypto.subtle.verify(
          ALGORITHM,
          key,
          base64UrlToBytes(signaturePart) as BufferSource,
          new TextEncoder().encode(`${headerPart}.${payloadPart}`),
        );
        if (!signed) return null;

        const claims = JSON.parse(decodeSegment(payloadPart)) as JwtClaims;
        // A valid signature only proves Access issued the token. These three
        // prove it was issued for *this* application, by *our* team, and is
        // still live — without them a token minted for any other Access app
        // would sail straight through.
        if (claims.iss !== issuer) return null;
        if (!audienceMatches(claims.aud, config.aud)) return null;

        const seconds = now();
        if (typeof claims.exp !== 'number' || claims.exp <= seconds) return null;
        if (typeof claims.nbf === 'number' && claims.nbf > seconds) return null;

        return {
          email: typeof claims.email === 'string' ? claims.email : null,
          sub: typeof claims.sub === 'string' ? claims.sub : '',
          expiresAt: claims.exp,
        };
      } catch {
        // A malformed token, key or JSON body is "not authenticated", not a crash.
        return null;
      }
    },
  };
}

/**
 * The token Access forwards. The header is the documented, reliable carrier;
 * the cookie is read only as a fallback, because Access does not guarantee it
 * is passed through to the origin.
 */
export function extractAccessToken(request: Request): string | null {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header;

  const cookie = request.headers.get('cookie');
  if (!cookie) return null;

  for (const pair of cookie.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== 'CF_Authorization') continue;
    return pair.slice(separator + 1).trim() || null;
  }

  return null;
}

/** `balier` / `balier.cloudflareaccess.com` / `https://…` → the `iss` value. */
export function normalizeTeamDomain(teamDomain: string): string | null {
  const trimmed = teamDomain?.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  const host = trimmed.replace(/^https?:\/\//, '');
  if (!host) return null;

  return `https://${host.includes('.') ? host : `${host}.cloudflareaccess.com`}`;
}

/**
 * Keys rotate every six weeks, with the previous key staying valid for seven
 * days, so a `kid` miss is a real "reject" rather than something to retry.
 * The certs endpoint is fetched per verification: the admin panel is one
 * person's internal tool, and a cache here would be module-scope state, which
 * the Workers runtime forbids (`docs/OVERVIEW.md`).
 */
async function fetchSigningKey(
  fetchImpl: typeof fetch,
  issuer: string,
  kid: string,
): Promise<JsonWebKey | null> {
  const response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) return null;

  const certs = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  return certs.keys?.find((key) => key.kid === kid) ?? null;
}

function audienceMatches(aud: JwtClaims['aud'], expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  return Array.isArray(aud) && aud.includes(expected);
}

function decodeSegment(segment: string): string {
  return new TextDecoder().decode(base64UrlToBytes(segment));
}

function base64UrlToBytes(segment: string): Uint8Array {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
