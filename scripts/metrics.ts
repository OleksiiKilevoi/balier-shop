import { createSign } from 'node:crypto';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, gte, lt } from 'drizzle-orm';
import * as schema from '@balier/lib/db/schema';
import { campaignEconomics, foldTraffic, summarizeOrdersByCampaign } from '@balier/lib/metrics/report';
import type { CampaignTraffic } from '@balier/lib/metrics/report';

/**
 * The campaign report, run from this machine: `pnpm metrics`.
 *
 * Three sources, three windows (2 days, 7 days, since the launch):
 *  - GA4 Data API — the linked Google Ads account's impressions, clicks and
 *    cost per campaign, plus sessions, carts and purchases GA4 saw;
 *  - Search Console — organic clicks and impressions, for scale;
 *  - the production database — orders by the campaign that brought the buyer,
 *    which is the number the money decisions are made on.
 *
 * Auth: the Search Console service account (`GSC_CREDENTIALS_PATH`, default
 * `~/.config/gsc/balier-gsc.json`) — it must also be a Viewer on the GA4
 * property. `DATABASE_URL` comes from `.dev.vars`, like the other scripts.
 *
 * GA4 reports cost and revenue in the property's currency, which it states in
 * every response. The database is in hryvnias. The ratios across the two
 * (cost per sale, ROAS) are printed only when the currencies match.
 * Each run appends one JSON line to `.metrics/log.jsonl` (ignored by git), so
 * the trend accumulates between runs.
 */

loadEnv({ path: '.dev.vars', quiet: true });
loadEnv({ quiet: true });

const GA4_PROPERTY = '286962167';
const GSC_SITE = 'sc-domain:balier.com.ua';
const LAUNCH = '2026-10-30';
const CREDENTIALS = process.env.GSC_CREDENTIALS_PATH ?? join(homedir(), '.config/gsc/balier-gsc.json');

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDay(d);
};
const today = isoDay(new Date());
const windows = [
  { label: '2 дні', from: daysAgo(1) },
  { label: '7 днів', from: daysAgo(6) },
  { label: `з ${LAUNCH}`, from: LAUNCH },
];

/* ------------------------------------------------------------ google auth */

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

async function accessToken(scopes: string[]): Promise<string> {
  const key = JSON.parse(readFileSync(CREDENTIALS, 'utf8')) as ServiceAccount;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`token: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function googleJson<T>(url: string, token: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/* ------------------------------------------------------------------- GA4 */

interface Ga4Report {
  /** ISO 4217 code of the property's reporting currency. */
  currency: string;
  rows: CampaignTraffic[];
}

interface RunReportResponse {
  metadata?: { currencyCode?: string };
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
}

async function ga4Campaigns(token: string, from: string): Promise<Ga4Report> {
  const metrics = [
    'advertiserAdImpressions',
    'advertiserAdClicks',
    'advertiserAdCost',
    'sessions',
    'addToCarts',
    'ecommercePurchases',
    'purchaseRevenue',
  ];
  const data = await googleJson<RunReportResponse>(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY}:runReport`,
    token,
    {
      dateRanges: [{ startDate: from, endDate: today }],
      dimensions: [{ name: 'sessionCampaignName' }],
      metrics: metrics.map((name) => ({ name })),
      limit: 50,
    },
  );
  const rows = (data.rows ?? [])
    .map((row) => {
      const m = row.metricValues.map((v) => Number(v.value));
      return {
        campaign: row.dimensionValues[0]?.value ?? '(not set)',
        impressions: m[0] ?? 0,
        clicks: m[1] ?? 0,
        cost: m[2] ?? 0,
        sessions: m[3] ?? 0,
        addToCarts: m[4] ?? 0,
        purchases: m[5] ?? 0,
        revenue: m[6] ?? 0,
      };
    })
    .filter((row) => row.cost > 0 || row.clicks > 0 || row.campaign !== '(not set)');
  return { currency: data.metadata?.currencyCode ?? '?', rows: foldTraffic(rows) };
}

/* --------------------------------------------------------- Search Console */

async function organic(token: string, from: string): Promise<{ clicks: number; impressions: number }> {
  // Search Console data lags ~2 days; the last two days come back empty, not wrong.
  const data = await googleJson<{ rows?: { clicks: number; impressions: number }[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`,
    token,
    { startDate: from, endDate: today, dimensions: [] },
  );
  const row = data.rows?.[0];
  return { clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0 };
}

/* -------------------------------------------------------------- database */

async function ordersSince(from: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set — copy .dev.vars.example to .dev.vars first.');
  const db = drizzle(neon(databaseUrl), { schema });
  const end = new Date(`${today}T23:59:59.999Z`);
  return db
    .select({
      status: schema.orders.status,
      paymentMethod: schema.orders.paymentMethod,
      total: schema.orders.total,
      createdAt: schema.orders.createdAt,
      attribution: schema.orders.attribution,
    })
    .from(schema.orders)
    .where(and(gte(schema.orders.createdAt, new Date(`${from}T00:00:00Z`)), lt(schema.orders.createdAt, end)));
}

/* ---------------------------------------------------------------- report */

const uah = (n: number) => `${n.toFixed(0)} ₴`;
const money = (n: number, currency: string) => (currency === 'UAH' ? uah(n) : `${n.toFixed(2)} ${currency}`);
const pct = (n?: number) => (n === undefined ? '—' : `${(n * 100).toFixed(1)} %`);
const num = (n?: number, suffix = '') => (n === undefined ? '—' : `${n}${suffix}`);

async function main() {
  const token = await accessToken([
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/webmasters.readonly',
  ]);

  const record: Record<string, unknown> = { at: new Date().toISOString() };
  console.log(`\nBÁLIER — метрики на ${today}\n`);

  for (const window of windows) {
    const [ads, seo, orders] = await Promise.all([
      ga4Campaigns(token, window.from).catch((err: Error) => ({ error: err.message })),
      organic(token, window.from).catch((err: Error) => ({ error: err.message })),
      ordersSince(window.from),
    ]);
    const byCampaign = summarizeOrdersByCampaign(orders);

    console.log(`━━ ${window.label} (${window.from} → ${today}) ━━`);

    if ('error' in ads) {
      console.log(`  GA4: недоступно — ${ads.error.replace(/\s+/g, ' ').slice(0, 260)}`);
    } else if (ads.rows.length === 0) {
      console.log('  GA4: кампаний с данными пока нет');
    } else {
      const sameCurrency = ads.currency === 'UAH';
      if (!sameCurrency) {
        console.log(
          `  ⚠ GA4 считает деньги в ${ads.currency}, база — в гривнах: расход и CPC ниже в ${ads.currency}, ` +
            'цена продажи и ROAS не считаются. Лечится валютой ресурса GA4: Администратор → Сведения о ресурсе → UAH.',
        );
      }
      for (const row of ads.rows) {
        const sales = byCampaign.find((c) => c.campaign === row.campaign);
        const eco = campaignEconomics({
          impressions: row.impressions,
          clicks: row.clicks,
          cost: row.cost,
          sales: sales?.sales ?? 0,
          revenue: (sales?.revenue ?? 0) / 100,
        });
        console.log(
          `  ${row.campaign}: показы ${row.impressions}, клики ${row.clicks}, CTR ${pct(eco.ctr)}, ` +
            `расход ${money(row.cost, ads.currency)}, CPC ${eco.cpc === undefined ? '—' : money(eco.cpc, ads.currency)} · ` +
            `сеансы ${row.sessions}, в корзину ${row.addToCarts}, покупок (GA4) ${row.purchases}`,
        );
        console.log(
          `    по базе: заказов ${sales?.orders ?? 0}, продаж ${sales?.sales ?? 0}, выручка ${uah((sales?.revenue ?? 0) / 100)}, ` +
            `цена продажи ${sameCurrency ? num(eco.costPerSale, ' ₴') : '—'}, ROAS ${sameCurrency ? num(eco.roas) : '—'}`,
        );
      }
    }

    // The database speaks even when GA4 does not: every campaign GA4 did not
    // list above, and all of them when GA4 was unavailable.
    const shown = 'error' in ads ? [] : ads.rows.map((a) => a.campaign);
    const other = byCampaign.filter((c) => !shown.includes(c.campaign));
    console.log(
      other.length
        ? `  заказы по базе: ` +
            other.map((c) => `${c.campaign} — продаж ${c.sales} из ${c.orders} (${uah(c.revenue / 100)})`).join(', ')
        : `  заказы по базе: ${byCampaign.length === 0 ? 'нет' : 'все перечислены выше'}`,
    );

    console.log('error' in seo ? `  органика: недоступно — ${seo.error.slice(0, 120)}` : `  органика Google: клики ${seo.clicks}, показы ${seo.impressions}`);
    console.log('');

    record[window.label] = { ads, seo, orders: byCampaign };
  }

  mkdirSync('.metrics', { recursive: true });
  appendFileSync('.metrics/log.jsonl', `${JSON.stringify(record)}\n`);
  console.log('записано в .metrics/log.jsonl');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
