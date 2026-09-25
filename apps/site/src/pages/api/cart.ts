import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { buildCartSummary, emptyCartSummary, mergeCartItems } from '@balier/lib/cart';
import { createDb } from '@balier/lib/db';
import { findBundleRules, findCartVariants, findCompanionOffer } from '@balier/lib/db/queries/cart';
import { missingCompanions } from '@balier/lib/cart/bundle';
import { cartRequestSchema } from '@balier/lib/validation/cart';

export const prerender = false;

/**
 * Server-side validation of the cart: the customer sends variant ids and
 * quantities, and gets back what those actually are — current prices, current
 * availability, and a notice for every line that had to change.
 *
 * This is the only place the `/cart` page gets prices from. It is also what
 * checkout will call before creating an order, so the two cannot disagree about
 * what a cart is worth.
 *
 * Rate limited per IP in `src/middleware.ts`.
 */
export const POST: APIRoute = async ({ request }) => {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = cartRequestSchema.safeParse(payload);
  if (!parsed.success) return json({ error: 'invalid_cart' }, 400);

  const items = mergeCartItems(parsed.data.items);
  // An empty cart is a valid cart, and answering it costs no database round trip.
  if (items.length === 0) return json(emptyCartSummary(), 200);

  const db = createDb(env.DATABASE_URL);
  const variants = await findCartVariants(
    db,
    items.map((item) => item.variantId),
  );

  const rules = await findBundleRules(db, [...new Set(variants.map((variant) => variant.productId))]);
  const summary = buildCartSummary(items, variants, rules);
  const offers = await Promise.all(
    missingCompanions(summary.lines, rules).map(({ companionProductId, percent }) =>
      findCompanionOffer(db, companionProductId, percent),
    ),
  );
  summary.offers = offers.filter((offer) => offer !== null);

  return json(summary, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Prices and stock are the point of this response; a cached one is a wrong one.
      'cache-control': 'no-store',
    },
  });
}
