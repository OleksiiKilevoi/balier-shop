/**
 * The headers every response should carry, storefront and panel alike. Added
 * after the 2026-09-22 audit found none of them set: the panel could be put in
 * a third-party iframe, and from inside that frame its own Origin satisfies
 * Astro's CSRF check, so clickjacking was the live risk rather than a
 * checklist item.
 *
 * Deliberately not a full `Content-Security-Policy`: Astro emits inline
 * `<script type="module">` blocks, so a real policy needs per-build hashes and
 * is its own change. `frame-ancestors` is the half that needs no hashes and
 * carries the risk, and it only works as a header — the `<meta>` form ignores
 * it.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), camera=(), microphone=(), payment=()',
  // A year, and the apex redirects www and http already.
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

/** The panel is never framed; the storefront only by itself. */
export function frameAncestors(policy: 'none' | 'self'): string {
  return `frame-ancestors '${policy}'`;
}

export function applySecurityHeaders(response: Response, policy: 'none' | 'self'): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  response.headers.set('content-security-policy', frameAncestors(policy));
  return response;
}

/**
 * The same set as a Cloudflare `_headers` block. Prerendered pages and static
 * assets are served straight off the asset binding and never reach the Worker
 * (`/about` answers `cf-cache-status: HIT`), so the middleware alone would
 * leave exactly the pages a visitor reads uncovered.
 */
export function headersFileBlock(policy: 'none' | 'self'): string {
  const lines = Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`);
  lines.push(`  content-security-policy: ${frameAncestors(policy)}`);
  return `/*\n${lines.join('\n')}\n`;
}
