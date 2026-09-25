import type { Kopiykas } from '../money';
import type { CreateInvoiceInput, Invoice, InvoiceStatus, PaymentPort } from '../ports';

/**
 * monobank «Покупка частинами» — a second `PaymentPort`, so checkout, the
 * webhook's `confirmPayment`, the cron reconciliation and the success page
 * treat it like the card invoice they already know.
 * https://monobank.ua/api-docs/chast
 *
 * The mapping onto the card vocabulary:
 * - «invoice» = the application (`order_id`), created with the order's own
 *   number as `store_order_id`, which makes a retried create return the same one;
 * - `success` = `IN_PROCESS/WAITING_FOR_STORE_CONFIRM` or any `SUCCESS/*` — the
 *   client approved in the app and monobank owes the shop the money;
 * - `failure` = any `FAIL/*` (declined, no limit, 15-minute push timeout…);
 * - `processing` = still waiting for the client;
 * - `removeInvoice` = `order/reject`, the store withdrawing before hand-over.
 *
 * Beyond the port: `confirm` — the hand-over that activates the plan and takes
 * the first payment — which the panel calls when the waybill is created.
 *
 * Auth is `store-id` + `signature` = base64(HMAC-SHA256(raw body, secret)), on
 * requests and on the callback alike.
 */

/**
 * The two legal texts monobank requires next to any advertising of the
 * product (knowledge-base/chast/marketing), verbatim. The first must be at
 * least half the size of the words «Покупка Частинами». Do not edit.
 */
export const PARTS_AD_LEGAL = [
  'Реальна річна процентна ставка — 0,000001%, макс. строк кредитування до 400 000 грн — 24 місяці. Перший внесок — аванс у розмірі щомісячного платежу.',
  'АТ "УНІВЕРСАЛ БАНК", Ліцензія НБУ №92 від 20.01.1994, у держреєстрі банків No226, деталі на monobank.ua',
] as const;

/** The product's name as the brand book spells it. */
export const PARTS_NAME = 'Покупка Частинами monobank';

/** What the customer may choose from in the app. */
export const PARTS_COUNTS = [3, 4, 6] as const;
/**
 * Below this the option is not offered. Kopiykas.
 * TEMPORARY (2026-09-25): 2 ₴ for monobank's pre-launch test purchase on a
 * 2 ₴ test product; back to 150_000 once the bank has activated the service.
 */
export const PARTS_MIN_TOTAL: Kopiykas = 200;

export interface MonoPartsConfig {
  /** `https://u2.monobank.com.ua` in production, `https://u2-demo-ext.mono.st4g3.com` in the sandbox. */
  baseUrl: string;
  storeId: string;
  secret: string;
}

export interface MonoPartsPayment extends PaymentPort {
  /** Goods handed over: activates the plan. Idempotent on monobank's side. */
  confirm(orderId: string): Promise<void>;
}

interface StateResponse {
  order_id: string;
  state: 'IN_PROCESS' | 'SUCCESS' | 'FAIL';
  order_sub_state: string;
}

export function mapPartsState(state: StateResponse['state'], subState: string): InvoiceStatus {
  if (state === 'FAIL') return 'failure';
  if (state === 'SUCCESS') return subState === 'RETURNED' ? 'reversed' : 'success';
  return subState === 'WAITING_FOR_STORE_CONFIRM' ? 'success' : 'processing';
}

export async function signBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  let binary = '';
  for (const byte of mac) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Hryvnias with kopiykas, as the API takes them: 1234.5 for 123 450 kopiykas. */
const hryvnias = (amount: Kopiykas) => amount / 100;

/**
 * The goods list monobank shows the client. It must add up to the total, so
 * when a promo discount breaks that (the items are empty then, see
 * `createOrder`), the order goes as one line.
 */
export function partsProducts(input: CreateInvoiceInput): { name: string; count: number; sum: number }[] {
  const itemsTotal = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  if (input.items.length === 0 || itemsTotal !== input.amount) {
    return [{ name: `Замовлення ${input.orderNumber}`, count: 1, sum: hryvnias(input.amount) }];
  }
  return input.items.map((item) => ({
    name: item.productTitle,
    count: item.quantity,
    sum: hryvnias(item.unitPrice),
  }));
}

export function createMonoPartsPayment(config: MonoPartsConfig): MonoPartsPayment {
  async function request<T>(path: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    const response = await fetch(new URL(path, config.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'store-id': config.storeId,
        signature: await signBody(body, config.secret),
      },
      body,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`monobank parts ${path} failed: ${response.status} ${text}`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  return {
    async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
      if (!input.customerPhone) throw new Error('monobank parts needs the client phone');
      const { order_id } = await request<{ order_id: string }>('/api/order/create', {
        store_order_id: input.orderNumber,
        client_phone: input.customerPhone,
        total_sum: hryvnias(input.amount),
        invoice: {
          number: input.orderNumber,
          date: new Date().toISOString().slice(0, 10),
          source: 'INTERNET',
        },
        // `type` is documented as unused, yet the API refuses the request without it.
        available_programs: [{ type: 'payment_installments', available_parts_count: [...PARTS_COUNTS] }],
        products: partsProducts(input),
        result_callback: input.webhookUrl,
      });
      // There is no hosted page: the client approves in the app. The customer
      // waits on our success page, which follows the order's status.
      return { invoiceId: order_id, pageUrl: input.redirectUrl };
    },

    async getInvoiceStatus(orderId: string): Promise<{ status: InvoiceStatus; amount: null }> {
      // The sum is ours, fixed at create and not changeable by monobank, so
      // there is no second figure to check it against (`/api/order/data`
      // would carry one, but the sandbox refuses it).
      const state = await request<StateResponse>('/api/order/state', { order_id: orderId });
      return { status: mapPartsState(state.state, state.order_sub_state), amount: null };
    },

    async verifyWebhook(rawBody: string, signature: string | null): Promise<boolean> {
      if (!signature) return false;
      const expected = await signBody(rawBody, config.secret);
      // Constant-time enough for a base64 HMAC compare of equal-length strings.
      if (expected.length !== signature.length) return false;
      let diff = 0;
      for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
      return diff === 0;
    },

    async removeInvoice(orderId: string): Promise<void> {
      await request<unknown>('/api/order/reject', { order_id: orderId });
    },

    async confirm(orderId: string): Promise<void> {
      await request<unknown>('/api/order/confirm', { order_id: orderId });
    },
  };
}

/** The env names the three Workers use. Any missing = «частинами» switched off. */
export interface MonoPartsEnv {
  MONO_PARTS_URL?: string;
  MONO_PARTS_STORE_ID?: string;
  MONO_PARTS_SECRET?: string;
}

/**
 * The switch. Off (2026-09-25) while monobank refuses the test application
 * (`ACCOUNT_CLOSED`) — the keys stay set, flip this back once the bank
 * confirms the service is active.
 */
export const PARTS_ENABLED = false;

export function monoPartsFromEnv(env: MonoPartsEnv): MonoPartsPayment | null {
  if (!PARTS_ENABLED) return null;
  if (!env.MONO_PARTS_URL || !env.MONO_PARTS_STORE_ID || !env.MONO_PARTS_SECRET) return null;
  return createMonoPartsPayment({
    baseUrl: env.MONO_PARTS_URL,
    storeId: env.MONO_PARTS_STORE_ID,
    secret: env.MONO_PARTS_SECRET,
  });
}
