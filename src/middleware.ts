import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { checkRateLimit } from '~/lib/rateLimit';

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
 */
const RULES: readonly { pathname: string; limit: number; windowSeconds: number }[] = [
  { pathname: '/api/checkout', limit: 5, windowSeconds: 300 },
  { pathname: '/api/cart', limit: 30, windowSeconds: 60 },
  { pathname: '/api/checkout/limits', limit: 30, windowSeconds: 60 },
  { pathname: '/api/checkout/np-settlements', limit: 60, windowSeconds: 60 },
  { pathname: '/api/checkout/np-warehouses', limit: 60, windowSeconds: 60 },
];

export const onRequest = defineMiddleware(async ({ request }, next) => {
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
