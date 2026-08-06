/**
 * The visitor's city, from Cloudflare's IP geolocation.
 *
 * Used only to preselect a *suggestion* at checkout. It is never trusted as an
 * answer: the customer confirms the settlement either way, and the order is
 * built from the ref they picked.
 *
 * Two sources, because neither is guaranteed:
 *
 *  - `request.cf` is workerd's per-request property bag, populated on every
 *    request that reaches a Worker through Cloudflare's edge. The Astro
 *    adapter passes the original `Request` through, but its `Runtime` type
 *    only declares `cfContext`, so `cf` has to be reached for structurally.
 *  - `cf-ipcity` appears instead when the zone has the "Add visitor location
 *    headers" managed transform enabled. Harmless to check if it doesn't.
 *
 * Absent locally and for any request that didn't come through the edge, which
 * is why every caller has to treat `null` as ordinary.
 */
interface CloudflareGeo {
  city?: string;
  country?: string;
}

export function visitorCity(request: Request): string | null {
  const cf = (request as Request & { cf?: CloudflareGeo }).cf;

  // Nova Poshta only delivers inside Ukraine, so a foreign city can only ever
  // resolve to a same-named village or to nothing. Skip the lookup entirely —
  // but not when the country is simply unknown, which is the local-dev case.
  const country = cf?.country ?? request.headers.get('cf-ipcountry');
  if (country && country !== 'UA') return null;

  const city = cf?.city ?? request.headers.get('cf-ipcity');
  return city?.trim() || null;
}
