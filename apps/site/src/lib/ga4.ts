/**
 * GA4 events through the `gtag` the layout defines (`BaseLayout.astro`,
 * production only). In dev there is no `gtag`, so an event is silently
 * dropped; in production `dataLayer` queues anything sent before the script
 * has loaded. Payload shapes come from `@balier/lib/analytics/ga4`, where
 * they are tested. Analytics never breaks a purchase: every call is wrapped.
 */
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function ga4(name: string, params: Record<string, unknown>): void {
  try {
    window.gtag?.('event', name, params);
  } catch {
    // Nothing a customer should ever notice.
  }
}
