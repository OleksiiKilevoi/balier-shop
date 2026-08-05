import { defineMiddleware, sequence } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { SESSION_COOKIE, verifySession } from '~/lib/auth';
import { checkRateLimit } from '~/lib/rateLimit';

/* --------------------------------------------------------------- admin gate */

/**
 * The admin gate: every `/admin/**` page and `/api/admin/**` route needs a
 * valid session cookie, minted by `/admin/login` against `admin_users`.
 *
 * This replaced a Cloudflare Access JWT check. The reason is ownership, not
 * security — Access worked — the panel is meant to be lifted into the next
 * business, and a gate that lives in one Cloudflare account's Zero Trust
 * dashboard does not travel with the code. The property that mattered most
 * about the old gate is kept exactly: **the check is in the application**, so
 * it holds on the `workers.dev` URL and anywhere else the Worker is reachable,
 * with no edge configuration to get wrong.
 *
 * Unconfigured still means denied. With `ADMIN_SESSION_SECRET` unset, nothing
 * verifies and every request here is turned away — including ours.
 *
 * There is **no development bypass**, unlike the gate this replaced. That one
 * needed it (nothing authenticates in front of `pnpm dev`); this one does not,
 * because the form works locally. So the login path that ships is the login
 * path that gets exercised every day. `scripts/admin-user.ts` creates the
 * account to log in with.
 */
const ADMIN_PREFIXES = ['/admin', '/api/admin'] as const;

export const ADMIN_LOGIN_PATH = '/admin/login';

/**
 * The two routes under `/admin` that must answer without a session: the form
 * itself (or nobody could ever get one) and sign-out (which only clears a
 * cookie, and has to work even when the session behind it has already lapsed).
 */
const PUBLIC_ADMIN_PATHS = new Set<string>([ADMIN_LOGIN_PATH, '/admin/logout']);

const adminGate = defineMiddleware(async ({ url, cookies, locals }, next) => {
  const pathname = url.pathname;
  const isAdmin = ADMIN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isAdmin || PUBLIC_ADMIN_PATHS.has(pathname)) return next();

  const session = await verifySession(env.ADMIN_SESSION_SECRET, cookies.get(SESSION_COOKIE)?.value);
  if (!session) return unauthorized(url);

  locals.admin = session;
  return next();
});

/**
 * A page and an API route want different things from "you are not signed in":
 * a person should land on the form, with the address they were trying to reach
 * carried along so the login finishes the journey; a fetch should get a status
 * it can branch on rather than an HTML login page it would try to parse.
 */
function unauthorized(url: URL): Response {
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  const target = new URL(ADMIN_LOGIN_PATH, url);
  // Path and query only. `next` is re-validated on the way out in
  // `login.astro` — this is a hint, not a trusted instruction.
  if (url.pathname !== '/admin') target.searchParams.set('next', `${url.pathname}${url.search}`);

  return new Response(null, {
    status: 303,
    headers: { location: `${target.pathname}${target.search}`, 'cache-control': 'no-store' },
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
 * Admin routes are absent on purpose — the gate above turns an unauthenticated
 * flood away before it reaches a handler. The one exception is the login form,
 * which is public by necessity and therefore brute-forceable; it carries its
 * own budget, applied inside `src/pages/admin/login.astro` rather than here, so
 * that hitting the limit can answer with the form and a message instead of a
 * bare 429 in front of a person who simply mistyped their password.
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
