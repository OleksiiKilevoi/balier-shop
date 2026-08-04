import { defineMiddleware, sequence } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { createAccessVerifier, extractAccessToken } from '~/lib/access';
import { checkRateLimit } from '~/lib/rateLimit';

/* --------------------------------------------------------------- admin gate */

/**
 * The server-side half of the admin gate `docs/CONVENTIONS.md` requires:
 * Cloudflare Access authenticates at the edge, and this verifies the JWT it
 * forwards before any admin page or admin API route runs. Edge configuration
 * alone is not enough — the Worker is also reachable on its `workers.dev` URL,
 * which no Access policy covers.
 *
 * Unconfigured means denied. Until an Access application exists (it needs a
 * domain on the Cloudflare account — see `docs/STATE.md`), every request here
 * answers 403, including ours.
 */
const ADMIN_PREFIXES = ['/admin', '/api/admin'] as const;

const adminGate = defineMiddleware(async ({ request, locals }, next) => {
  const pathname = new URL(request.url).pathname;
  const isAdmin = ADMIN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isAdmin) return next();

  // `pnpm dev` has no Access in front of it, so the panel would be unopenable
  // locally. `import.meta.env.DEV` is a build-time constant: it is `false` in
  // everything `pnpm build` emits, `pnpm preview` and the deployed Worker
  // included, so this cannot become a production bypass.
  if (import.meta.env.DEV) {
    locals.admin = { email: 'dev@localhost', sub: 'dev', expiresAt: 0 };
    return next();
  }

  const verifier = createAccessVerifier({
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    aud: env.CF_ACCESS_AUD,
  });
  const identity = await verifier.verify(extractAccessToken(request));
  if (!identity) return forbidden(pathname);

  locals.admin = identity;
  return next();
});

function forbidden(pathname: string): Response {
  const isApi = pathname.startsWith('/api/');

  return new Response(isApi ? JSON.stringify({ error: 'forbidden' }) : 'Доступ заборонено', {
    status: 403,
    headers: {
      'content-type': isApi
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------- rate limiting */

/**
 * Per-IP rate limiting for the public API routes named in
 * `docs/CONVENTIONS.md` (checkout, search, order creation) plus `/api/cart`,
 * which carries the same note in its own file. `/api/webhooks/monobank` is
 * deliberately excluded: it is already gated by `X-Sign` verification, and an
 * IP bucket would risk dropping genuine redeliveries from Monobank's own
 * infrastructure rather than an attacker's.
 *
 * Limits are sized to each route's real cost: `/api/checkout` calls
 * Turnstile/Monobank and creates an order, so it gets the tightest budget;
 * the two `np-*` search endpoints are debounced keystroke lookups against
 * our own DB and get a generous one.
 *
 * Admin routes are absent on purpose — they are gated by Access above, so an
 * unauthenticated flood never reaches them.
 */
const RULES: readonly { pathname: string; limit: number; windowSeconds: number }[] = [
  { pathname: '/api/checkout', limit: 5, windowSeconds: 300 },
  { pathname: '/api/cart', limit: 30, windowSeconds: 60 },
  { pathname: '/api/checkout/limits', limit: 30, windowSeconds: 60 },
  { pathname: '/api/checkout/np-settlements', limit: 60, windowSeconds: 60 },
  { pathname: '/api/checkout/np-warehouses', limit: 60, windowSeconds: 60 },
];

const rateLimit = defineMiddleware(async ({ request }, next) => {
  const pathname = new URL(request.url).pathname;
  const rule = RULES.find((r) => r.pathname === pathname);
  if (!rule) return next();

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const result = await checkRateLimit(
    env.RATE_LIMIT,
    `${pathname}:${ip}`,
    rule.limit,
    rule.windowSeconds,
  );

  if (!result.allowed) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(result.retryAfterSeconds),
      },
    });
  }

  return next();
});

export const onRequest = sequence(adminGate, rateLimit);
