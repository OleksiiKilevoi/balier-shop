import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb } from '@balier/lib/db';
import { orders } from '@balier/lib/db/schema';
import { waybillPrintUrl } from '@balier/lib/novaposhta/waybill';

/**
 * The parcel marking (100×100) for this order's waybill, fetched from Nova
 * Poshta server-side and streamed through.
 *
 * A proxy on purpose: NP's print endpoints take the API key **in the URL**
 * (`.../apiKey/<key>`), so the real URL can never be rendered into a page —
 * it would sit in the operator's history, their proxy logs, and anything they
 * paste it into. This route is behind the admin session gate like every other
 * page here, and the key never leaves the Worker.
 */
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const orderNumber = params.orderNumber!;
  const db = createDb(env.DATABASE_URL);

  const [order] = await db
    .select({ npTtn: orders.npTtn, npTtnRef: orders.npTtnRef })
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);

  // A hand-entered number has no ref, and printing takes the ref — the page
  // never links here for those, so a 404 is the honest answer to a typed URL.
  if (!order?.npTtnRef) return new Response('Немає накладної для друку', { status: 404 });
  if (!env.NOVAPOSHTA_API_KEY) {
    return new Response('NOVAPOSHTA_API_KEY не налаштовано', { status: 503 });
  }

  const upstream = await fetch(waybillPrintUrl(order.npTtnRef, 'marking', env.NOVAPOSHTA_API_KEY));
  if (!upstream.ok) {
    return new Response(`Нова Пошта не віддала документ (HTTP ${upstream.status})`, {
      status: 502,
    });
  }

  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/pdf',
      'content-disposition': `inline; filename="marking-${order.npTtn ?? orderNumber}.pdf"`,
      // Account state, like every page here — and the PDF's URL is stable
      // while its content (the waybill) is not guaranteed to be.
      'cache-control': 'no-store',
    },
  });
};
