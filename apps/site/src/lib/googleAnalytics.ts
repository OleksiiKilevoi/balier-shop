/**
 * Google Analytics 4 measurement ID, pasted by the owner 2026-10-23. Empty =
 * no GA4 tag on the site. It shares one `gtag.js` load with the Google Ads tag
 * in `~/layouts/BaseLayout.astro`; production builds only, like every tag.
 *
 * Mind the GTM container (`~/lib/googleTagManager.ts`): if a GA4 tag with this
 * same ID is ever added inside GTM, page views count twice — keep it in one
 * place only.
 */
export const GA4_MEASUREMENT_ID = 'G-P9NKSG62B4';
