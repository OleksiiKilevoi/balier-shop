import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { createDb } from '@balier/lib/db';
import { npScanSheets } from '@balier/lib/db/schema';
import { scanSheetPrintUrl } from '@balier/lib/novaposhta/scanSheet';

/**
 * The register of shipments as a PDF, fetched from Nova Poshta server-side and
 * streamed through — the same proxy the waybill marking takes, for the same
 * reason: NP's print endpoints carry the API key **in the URL**, so the real
 * URL can never be rendered into a page. Behind the admin session gate like
 * every other route here.
 */
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const ref = params.ref!;
  const db = createDb(env.DATABASE_URL);

  const [sheet] = await db.select().from(npScanSheets).where(eq(npScanSheets.ref, ref)).limit(1);

  if (!sheet) return new Response('Немає реєстру для друку', { status: 404 });
  if (!env.NOVAPOSHTA_API_KEY) {
    return new Response('NOVAPOSHTA_API_KEY не налаштовано', { status: 503 });
  }

  const upstream = await fetch(scanSheetPrintUrl(sheet.ref, env.NOVAPOSHTA_API_KEY));
  if (!upstream.ok) {
    return new Response(`Нова Пошта не віддала документ (HTTP ${upstream.status})`, {
      status: 502,
    });
  }

  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/pdf',
      'content-disposition': `inline; filename="register-${sheet.number}.pdf"`,
      // The URL is stable while the register's contents are not.
      'cache-control': 'no-store',
    },
  });
};
