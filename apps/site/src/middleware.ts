import { defineMiddleware, sequence } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import * as Sentry from '@sentry/cloudflare';
import { legacyRedirect } from '@balier/lib/legacyRedirects';
import { applySecurityHeaders } from '@balier/lib/securityHeaders';
import { checkRateLimit } from '@balier/lib/rateLimit';

/* ------------------------------------------------------------------ sentry */

/**
 * First in the sequence on purpose: every unhandled error from any page or
 * API route below is captured and **rethrown** — the customer still gets
 * their 500, Sentry only observes (`docs/plans/sentry.md`). Options are built
 * per request from `env` because the SDK holds no module-scope state (hard
 * rule 4), and the ExecutionContext lets it flush via `waitUntil`.
 */
const sentry = defineMiddleware((context, next) => {
  return Sentry.wrapRequestHandler(
    {
      options: {
        dsn: env.SENTRY_DSN,
        environment: env.SENTRY_ENVIRONMENT,
        // Errors only — no performance tracing.
        tracesSampleRate: 0,
        // One Sentry project for all three Workers; this tag tells them apart.
        initialScope: { tags: { worker: 'site' } },
      },
      request: context.request,
      context: context.locals.cfContext,
    },
    () => next(),
  );
});

/* ---------------------------------------------------------- admin redirect */

/**
 * The admin panel lives on its own Worker and hostname now
 * (`admin.balier.com.ua`, `apps/admin`). This Worker carries no admin
 * surface at all — the only trace left is this permanent redirect, which keeps
 * old bookmarks working by mapping `/admin/orders/…` to `/orders/…` on the
 * admin host. Everything after the prefix is the same path over there.
 */
const ADMIN_HOST = 'https://admin.balier.com.ua';

const adminRedirect = defineMiddleware(async ({ url }, next) => {
  const pathname = url.pathname;
  if (pathname !== '/admin' && !pathname.startsWith('/admin/')) return next();

  const rest = pathname === '/admin' ? '/' : pathname.slice('/admin'.length);
  return new Response(null, {
    status: 301,
    headers: { location: `${ADMIN_HOST}${rest}${url.search}`, 'cache-control': 'no-store' },
  });
});

/* --------------------------------------------------------- security headers */

/**
 * On every response the Worker makes. Prerendered pages and assets bypass the
 * Worker entirely, so `public/_headers` carries the same set for those —
 * both are generated from one place (`~/lib/securityHeaders`).
 */
const securityHeaders = defineMiddleware(async (_context, next) =>
  applySecurityHeaders(await next(), 'self'),
);

/* ------------------------------------------------------------- old site URLs */

/**
 * The previous site on this domain (2019–2025) left Google a few hundred URLs
 * that all 404 here — `~/lib/legacyRedirects` says where each one now goes.
 * 301, GET/HEAD only; a path it does not know falls through to the honest 404.
 */
const legacy = defineMiddleware(({ request, url }, next) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();
  const target = legacyRedirect(url.pathname);
  if (!target) return next();
  return new Response(null, {
    status: 301,
    headers: { location: target, 'cache-control': 'public, max-age=86400' },
  });
});

/* ------------------------------------------------------------- api noindex */

/**
 * The API answers crawlers too, and a blocked-in-robots URL can still be
 * indexed «blind» from a link (the 2026-09-21 coverage report had four).
 * So `/api/*` is crawlable and says `noindex` itself — the same «allow the
 * crawl, refuse the index» the pages use, only as a header, since JSON has
 * no `<head>`.
 */
const apiNoindex = defineMiddleware(async ({ url }, next) => {
  const response = await next();
  if (url.pathname.startsWith('/api/')) response.headers.set('x-robots-tag', 'noindex');
  return response;
});

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
 * Admin routes are gone from this Worker entirely; the login form's own
 * brute-force budget lives with it in `apps/admin`.
 */
const RULES: readonly { pathname: string; limit: number; windowSeconds: number }[] = [
  { pathname: '/api/checkout', limit: 5, windowSeconds: 300 },
  // Sends an e-mail per call — a budget that stops address spraying, not people.
  { pathname: '/api/promo/subscribe', limit: 5, windowSeconds: 600 },
  { pathname: '/api/cart', limit: 30, windowSeconds: 60 },
  // Unauthenticated order lookup: one DB round trip per call, and its 200/404
  // split is an oracle on order numbers however impractical to enumerate.
  { pathname: '/checkout/success', limit: 30, windowSeconds: 60 },
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

export const onRequest = sequence(sentry, securityHeaders, legacy, adminRedirect, apiNoindex, rateLimit);
