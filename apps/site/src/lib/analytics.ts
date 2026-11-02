/**
 * Funnel events for One Dollar Stats (docs.onedollarstats.com/send-events).
 *
 * Page views already cover product → /checkout → /checkout/success; these
 * fill the steps between them. The script (`BaseLayout`) loads in production
 * only and deferred, so `window.stonks` is missing in dev and for a moment on
 * load — a missed event there is fine, a thrown one is not. Values are strings
 * and must not contain `;` or `=`. No personal data in props, ever.
 */

import { attributionEventProps, readStoredAttribution } from '@balier/lib/attribution';

export type AnalyticsEvent = 'Add to cart' | 'Order placed' | 'Promo signup';

declare global {
  interface Window {
    stonks?: { event(name: string, props?: Record<string, string>): void };
  }
}

/**
 * Every event carries the visit's `utm_source`, `utm_medium` and
 * `utm_campaign` (the same record the order is attributed from), so the stats
 * dashboard can compare events by campaign and not only page views. The
 * event's own props keep their names; the prefix is what keeps them apart.
 */
export function track(name: AnalyticsEvent, props?: Record<string, string>): void {
  try {
    window.stonks?.event(name, { ...attributionEventProps(readStoredAttribution()), ...props });
  } catch {
    // Analytics never breaks a purchase.
  }
}
