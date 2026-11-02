/**
 * The campaign report `pnpm metrics` prints: orders from the database folded
 * by the campaign that brought the buyer, and the ad economics that follow
 * from them. Pure, so the arithmetic is tested; the script around it fetches
 * GA4, Search Console and the database and formats the result.
 */
import type { Attribution } from '../attribution';

export interface ReportOrder {
  status: string;
  paymentMethod: string;
  total: number;
  createdAt: Date;
  attribution: Attribution | null | undefined;
}

export interface CampaignOrders {
  campaign: string;
  /** Every order that named this campaign, whatever became of it. */
  orders: number;
  /** Paid card / parts orders and confirmed cash on delivery — real sales. */
  sales: number;
  cancelled: number;
  /** Kopiykas, sales only. */
  revenue: number;
}

/** Statuses from which a card order has been paid; COD counts once confirmed. */
const PAID_ONWARD = new Set(['paid', 'packed', 'shipped', 'arrived', 'delivered']);

function isSale(order: ReportOrder): boolean {
  if (order.paymentMethod === 'cod') return order.status !== 'cancelled' && order.status !== 'pending';
  return PAID_ONWARD.has(order.status);
}

/**
 * GA4 names an auto-tagged Google Ads click by the campaign's name in Google
 * Ads; the final-URL suffix and therefore the database say the UTM slug. One
 * campaign, one name — the slug.
 */
const CAMPAIGN_ALIASES: Record<string, string> = {
  'Search · Сумки · UA': 'search-sumky-ua',
};

export const canonicalCampaign = (name: string): string => CAMPAIGN_ALIASES[name] ?? name;

/** The bucket an order falls into: its campaign, else its source, else «direct». */
export function orderCampaign(attribution: Attribution | null | undefined): string {
  return canonicalCampaign(attribution?.campaign ?? attribution?.source ?? attribution?.referrer ?? 'direct');
}

/** One GA4 row: Google Ads delivery plus what GA4 saw on the site, in the property's currency. */
export interface CampaignTraffic {
  campaign: string;
  impressions: number;
  clicks: number;
  cost: number;
  sessions: number;
  addToCarts: number;
  purchases: number;
  revenue: number;
}

/** Sums the rows that are one campaign under two names; first-seen order. */
export function foldTraffic(rows: readonly CampaignTraffic[]): CampaignTraffic[] {
  const folded = new Map<string, CampaignTraffic>();
  for (const row of rows) {
    const campaign = canonicalCampaign(row.campaign);
    const into = folded.get(campaign);
    if (!into) {
      folded.set(campaign, { ...row, campaign });
      continue;
    }
    for (const key of ['impressions', 'clicks', 'cost', 'sessions', 'addToCarts', 'purchases', 'revenue'] as const) {
      into[key] += row[key];
    }
  }
  return [...folded.values()];
}

export function summarizeOrdersByCampaign(orders: readonly ReportOrder[]): CampaignOrders[] {
  const rows = new Map<string, CampaignOrders>();
  for (const order of orders) {
    const campaign = orderCampaign(order.attribution);
    const row = rows.get(campaign) ?? { campaign, orders: 0, sales: 0, cancelled: 0, revenue: 0 };
    row.orders += 1;
    if (order.status === 'cancelled') row.cancelled += 1;
    if (isSale(order)) {
      row.sales += 1;
      row.revenue += order.total;
    }
    rows.set(campaign, row);
  }
  return [...rows.values()];
}

export interface CampaignEconomics {
  ctr?: number;
  cpc?: number;
  costPerSale?: number;
  roas?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ratios, cost and revenue in one currency; each left out when its denominator is zero. */
export function campaignEconomics(input: {
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  revenue: number;
}): CampaignEconomics {
  const out: CampaignEconomics = {};
  if (input.impressions > 0) out.ctr = round2(input.clicks / input.impressions);
  if (input.clicks > 0) out.cpc = round2(input.cost / input.clicks);
  if (input.sales > 0) out.costPerSale = round2(input.cost / input.sales);
  if (input.cost > 0) out.roas = round2(input.revenue / input.cost);
  return out;
}
