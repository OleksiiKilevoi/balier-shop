/**
 * Where an order's customer came from — kept in the browser from the visit
 * that brought them and sent with the order (`orders.attribution`), so the
 * panel can say «Instagram» on an order instead of nothing.
 *
 * Last *non-direct* touch, for 30 days: a visit with UTM tags or an outside
 * referrer replaces what is stored, a plain direct visit does not. A buyer who
 * came from Instagram and came back the next evening by typing the address is
 * still an Instagram sale, which is the question the owner is asking.
 *
 * No personal data: the referrer is kept as a host only — a full referrer URL
 * can carry someone's search terms or a private link — and the tags are
 * whatever the shop itself wrote into its own links.
 */
export interface Attribution {
  /** `utm_source` etc., verbatim from the landing URL. */
  source?: string;
  medium?: string;
  campaign?: string;
  /** Referrer host only (`l.instagram.com`), or the app id an Android app reports. */
  referrer?: string;
  /** The path the visit landed on, without the query string. */
  landing?: string;
  /** ISO time of that visit. */
  at?: string;
}

export const ATTRIBUTION_STORAGE_KEY = 'balier_attribution';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Hosts that are part of a purchase, not a source of one: the shop itself and
 * the payment pages the buyer is sent to and comes back from.
 */
function isInternalHost(host: string, ownHost: string): boolean {
  return (
    host === ownHost ||
    host.endsWith(`.${ownHost}`) ||
    host === 'monobank.ua' ||
    host.endsWith('.monobank.ua')
  );
}

/** Host of a referrer, `android-app://org.telegram.messenger/` included; null when there is none. */
function referrerHost(referrer: string): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * What to store after a page view. Returns `stored` itself when nothing
 * should change, so the caller can skip the write.
 */
export function nextAttribution(
  stored: Attribution | null,
  visit: { search: string; referrer: string; path: string; ownHost: string; now: Date },
): Attribution | null {
  const params = new URLSearchParams(visit.search);
  const tag = (name: string) => params.get(name)?.trim().slice(0, 100) || undefined;
  const source = tag('utm_source');
  const medium = tag('utm_medium');
  const campaign = tag('utm_campaign');
  const host = referrerHost(visit.referrer);
  const outsideReferrer = host && !isInternalHost(host, visit.ownHost) ? host : undefined;

  const touch: Attribution = {
    ...(source ? { source } : {}),
    ...(medium ? { medium } : {}),
    ...(campaign ? { campaign } : {}),
    ...(outsideReferrer ? { referrer: outsideReferrer } : {}),
    landing: visit.path.slice(0, 200),
    at: visit.now.toISOString(),
  };
  if (source || outsideReferrer) return touch;
  // Coming back from the bank, or clicking around the shop: not a new visit.
  // (An empty slot here means storage was cleared mid-visit — start one.)
  if (host) return stored ?? touch;

  // A direct visit only fills an empty or expired slot.
  const storedAt = stored?.at ? Date.parse(stored.at) : NaN;
  const fresh = Number.isFinite(storedAt) && visit.now.getTime() - storedAt < MAX_AGE_MS;
  return stored && fresh ? stored : touch;
}

const CHANNELS: [RegExp, string][] = [
  [/^(ig|instagram)$|(^|\.)instagram\.com$/, 'Instagram'],
  [/^(fb|facebook)$|(^|\.)facebook\.com$|^fb\.me$/, 'Facebook'],
  [/^threads$|(^|\.)threads\.(net|com)$/, 'Threads'],
  [/^(tg|telegram)$|^t\.me$|telegram/, 'Telegram'],
  [/^viber$|viber/, 'Viber'],
  [/^tiktok$|(^|\.)tiktok\.com$/, 'TikTok'],
  [/^google$|(^|\.)google\.[a-z.]+$|^com\.google\.android/, 'Google'],
  [/(^|\.)bing\.com$|^bing$/, 'Bing'],
];

/**
 * What `BaseLayout` kept in this browser about where the visitor came from,
 * or null: no record, no storage (private mode, server), or a record that
 * does not parse. Never throws — nothing that reads it may block a sale.
 */
export function readStoredAttribution(): Attribution | null {
  try {
    // Through `globalThis`, typed structurally: this file is also compiled by
    // the Workers packages, whose tsconfig has no DOM lib (`env.d.ts`).
    const storage = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage;
    const raw = storage?.getItem(ATTRIBUTION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch {
    return null;
  }
}

/** One Dollar Stats forbids `;` and `=` in event values (they delimit props). */
const forbidden = (value: string) => value.replace(/[;=]/g, '-').slice(0, 64);

/**
 * The source, medium and campaign of the visit as event props, so «Add to
 * cart» and «Order placed» in One Dollar Stats can be compared by campaign
 * the way page views already can. Tags when the visit had them, else the
 * referrer host as the source; nothing at all for a direct visit. Named
 * `utm_*` on purpose: «Add to cart» already has a `source` of its own (the
 * button it came from), and the first live test lost the campaign to it.
 */
export function attributionEventProps(attribution: Attribution | null | undefined): Record<string, string> {
  if (!attribution) return {};
  const props: Record<string, string> = {};
  const source = attribution.source ?? attribution.referrer;
  if (source) props.utm_source = forbidden(source);
  if (attribution.medium) props.utm_medium = forbidden(attribution.medium);
  if (attribution.campaign) props.utm_campaign = forbidden(attribution.campaign);
  return props;
}

/** The panel's one-line answer: «Instagram», «Google», «Прямий захід». */
export function attributionChannel(attribution: Attribution | null): string {
  if (!attribution) return 'Невідомо';
  for (const value of [attribution.source, attribution.referrer]) {
    if (!value) continue;
    const lower = value.toLowerCase();
    const match = CHANNELS.find(([pattern]) => pattern.test(lower));
    if (match) return match[1];
  }
  return attribution.source ?? attribution.referrer ?? 'Прямий захід';
}

/** The detail under the channel: tags, referrer, landing page — whatever was recorded. */
export function attributionDetails(attribution: Attribution): string {
  const tags = [attribution.source, attribution.medium, attribution.campaign].filter(Boolean).join(' / ');
  return [
    tags && `utm: ${tags}`,
    attribution.referrer && `з ${attribution.referrer}`,
    attribution.landing && `перша сторінка ${attribution.landing}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
