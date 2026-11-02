import { describe, expect, it } from 'vitest';
import { campaignEconomics, canonicalCampaign, foldTraffic, summarizeOrdersByCampaign } from './report';

const day = (d: string) => new Date(`${d}T10:00:00Z`);

describe('summarizeOrdersByCampaign', () => {
  const orders = [
    { status: 'paid', paymentMethod: 'card', total: 450_000, createdAt: day('2026-11-01'), attribution: { source: 'google', medium: 'cpc', campaign: 'search-sumky-ua' } },
    { status: 'confirmed', paymentMethod: 'cod', total: 195_000, createdAt: day('2026-11-01'), attribution: { source: 'google', medium: 'cpc', campaign: 'search-sumky-ua' } },
    { status: 'cancelled', paymentMethod: 'card', total: 540_000, createdAt: day('2026-11-02'), attribution: { source: 'google', medium: 'cpc', campaign: 'search-sumky-ua' } },
    { status: 'awaiting_payment', paymentMethod: 'card', total: 100_000, createdAt: day('2026-11-02'), attribution: { source: 'google', medium: 'cpc', campaign: 'search-sumky-ua' } },
    { status: 'paid', paymentMethod: 'card', total: 420_000, createdAt: day('2026-11-02'), attribution: { source: 'ig', medium: 'stories' } },
    { status: 'paid', paymentMethod: 'card', total: 150_000, createdAt: day('2026-11-02'), attribution: null },
  ] as const;

  it('counts only paid cards and confirmed cash-on-delivery as sales, per campaign', () => {
    const rows = summarizeOrdersByCampaign(orders);
    expect(rows.find((r) => r.campaign === 'search-sumky-ua')).toEqual({
      campaign: 'search-sumky-ua',
      orders: 4,
      sales: 2,
      cancelled: 1,
      revenue: 645_000,
    });
  });

  it('files untagged visits under their source and direct ones under «direct»', () => {
    const rows = summarizeOrdersByCampaign(orders);
    expect(rows.map((r) => r.campaign)).toEqual(['search-sumky-ua', 'ig', 'direct']);
  });
});

describe('canonicalCampaign', () => {
  it('maps the Google Ads campaign name GA4 reports to the slug the UTM suffix and the database use', () => {
    expect(canonicalCampaign('Search · Сумки · UA')).toBe('search-sumky-ua');
    expect(canonicalCampaign('search-sumky-ua')).toBe('search-sumky-ua');
    expect(canonicalCampaign('(direct)')).toBe('(direct)');
  });
});

describe('foldTraffic', () => {
  it('sums the GA4 rows of one campaign under its canonical name, keeping first-seen order', () => {
    const blank = { impressions: 0, clicks: 0, cost: 0, addToCarts: 0, purchases: 0, revenue: 0 };
    const rows = foldTraffic([
      { ...blank, campaign: 'Search · Сумки · UA', impressions: 1730, clicks: 90, cost: 11.3, sessions: 74 },
      { ...blank, campaign: '(direct)', sessions: 24, addToCarts: 1 },
      { ...blank, campaign: 'search-sumky-ua', sessions: 4, addToCarts: 2 },
    ]);
    expect(rows).toEqual([
      { ...blank, campaign: 'search-sumky-ua', impressions: 1730, clicks: 90, cost: 11.3, sessions: 78, addToCarts: 2 },
      { ...blank, campaign: '(direct)', sessions: 24, addToCarts: 1 },
    ]);
  });
});

describe('campaignEconomics', () => {
  it('derives CPC, CTR, cost per sale and ROAS, cost and revenue in one currency', () => {
    expect(campaignEconomics({ impressions: 400, clicks: 28, cost: 240, sales: 2, revenue: 6450 })).toEqual({
      ctr: 0.07,
      cpc: 8.57,
      costPerSale: 120,
      roas: 26.88,
    });
  });

  it('leaves cost per sale and ROAS undefined with nothing to divide by', () => {
    expect(campaignEconomics({ impressions: 0, clicks: 0, cost: 0, sales: 0, revenue: 0 })).toEqual({});
  });
});
