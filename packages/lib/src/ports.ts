import type { Kopiykas } from './money';
import type { DeliveryMethod, Order, OrderItem } from './db/schema';

/**
 * Ports — the boundaries between our domain and the outside world.
 *
 * Domain code (`src/lib/orders/**`) depends on these interfaces only. Concrete
 * adapters live in `src/lib/monobank/`, `src/lib/novaposhta/`, `src/lib/notify/`.
 * This is what makes checkout testable without hitting a real acquirer, and what
 * makes swapping a provider a one-file change.
 */

/* ------------------------------------------------------------------ payment */

export interface CreateInvoiceInput {
  orderNumber: string;
  amount: Kopiykas;
  items: readonly Pick<OrderItem, 'productTitle' | 'unitPrice' | 'quantity' | 'sku'>[];
  redirectUrl: string;
  webhookUrl: string;
  /** `+380…` — required by monobank «Покупка частинами», ignored by the card invoice. */
  customerPhone?: string;
  /** Seconds the invoice stays payable. Must match the stock reservation TTL. */
  validitySeconds: number;
}

export interface Invoice {
  invoiceId: string;
  /** Hosted payment page the customer is redirected to. */
  pageUrl: string;
}

export type InvoiceStatus =
  | 'created'
  | 'processing'
  | 'hold'
  | 'success'
  | 'failure'
  | 'reversed'
  | 'expired';

export interface PaymentPort {
  createInvoice(input: CreateInvoiceInput): Promise<Invoice>;
  /**
   * Authoritative status straight from the provider. The webhook body is only a
   * hint that something changed — always confirm through this. `amount` is
   * null for a provider that does not report the charged sum (monobank
   * «Покупка частинами», where the sum is the one we fixed at creation).
   */
  getInvoiceStatus(
    invoiceId: string,
  ): Promise<{ status: InvoiceStatus; amount: Kopiykas | null }>;
  /** Verifies the raw request body against the provider signature header. */
  verifyWebhook(rawBody: string, signature: string | null): Promise<boolean>;
  /**
   * Invalidates a not-yet-paid invoice so its payment link stops working.
   * Called when the order behind an invoice is cancelled — without it the link
   * outlives the order and a customer holding it can still pay. May throw
   * (e.g. the invoice already finished); callers treat removal as best-effort.
   */
  removeInvoice(invoiceId: string): Promise<void>;
}

/* ----------------------------------------------------------------- shipping */

export interface Settlement {
  ref: string;
  name: string;
  area: string | null;
  region: string | null;
}

export interface Warehouse {
  ref: string;
  settlementRef: string;
  number: string | null;
  description: string;
  isPostomat: boolean;
}

/**
 * Who the parcel goes to, resolved by the caller from the order plus the shop's
 * own reference tables. Names are already split: Nova Poshta wants surname and
 * given name separately for a private person, and how to split (or refuse) a
 * one-field `customer_name` is the waybill *form's* problem, not the carrier's.
 */
export interface WaybillRecipient {
  lastName: string;
  firstName: string;
  /** По батькові, when the operator typed one — the counterparty carries it. */
  middleName: string | null;
  /** `+380XXXXXXXXX`, checkout's canonical form. */
  phone: string;
  /**
   * The recipient **city** ref (`np_warehouses.city_ref`, resolved via
   * `getWarehouseCityRef` from the order's branch), NOT the settlement ref the
   * order stores. They are different dictionaries at Nova Poshta, the API
   * refuses nothing but ships wrong if they are confused, and this sentence is
   * here because that mistake is otherwise inevitable.
   */
  cityRef: string;
  /** The branch/locker ref the order stores (`orders.np_warehouse_ref`). */
  warehouseRef: string;
}

/** The sender half, straight from `getNpSenderSettings` — all refs required by
 * the time a waybill is being made; the form refuses earlier when they are not. */
export interface WaybillSender {
  counterpartyRef: string;
  contactRef: string;
  phone: string;
  /** City ref (`getCities` dictionary), like the recipient's. */
  cityRef: string;
  warehouseRef: string;
}

export interface CreateWaybillInput {
  sender: WaybillSender;
  recipient: WaybillRecipient;
  /** Summed over the order's items, confirmed (possibly edited) by the operator. */
  weightGrams: number;
  /** Boxes inside the one waybill (`SeatsAmount`); every seat gets the dimensions below. */
  seats: number;
  dimensionsCm: { length: number; width: number; height: number };
  /** What the waybill says is inside. */
  description: string;
  /** Insurance value; defaults to the order's `itemsTotal` at the form. */
  declaredValueKopiykas: Kopiykas;
  /**
   * Cash on delivery: the money the carrier collects and transfers back, or
   * null for a prepaid order. Creating such a waybill works even on a personal
   * NP key (verified live 2026-08-07); whether the transfer actually pays out
   * at handover without a business contract is still the open question in
   * docs/plans/novaposhta.md, «Constraints».
   */
  codKopiykas: Kopiykas | null;
}

export interface CreatedWaybill {
  /** Internal document Ref — what deletion and printing take. */
  ref: string;
  /** The printed 14-digit number — what tracking and the customer take. */
  number: string;
  /** The carrier's own delivery estimate, `dd.mm.yyyy`, when it gives one. */
  estimatedDeliveryDate: string | null;
}

export interface WaybillTracking {
  number: string;
  /** Verbatim carrier code, e.g. `"9"` — see `novaposhta/tracking.ts` for the map. */
  statusCode: string;
  statusText: string;
}

export interface ScanSheetInfo {
  ref: string;
  number: string;
}

/** The two papers printed per waybill; the register has its own URL builder. */
export type WaybillPrintKind = 'marking' | 'document';

export interface ShippingPort {
  searchSettlements(query: string, limit?: number): Promise<Settlement[]>;
  listWarehouses(settlementRef: string): Promise<Warehouse[]>;
  /** Returns kopiykas, or null when the carrier cannot quote the route. */
  quote(input: {
    settlementRef: string;
    method: DeliveryMethod;
    weightKg: number;
    declaredValue: Kopiykas;
  }): Promise<Kopiykas | null>;

  /* --- waybills (NP-2; consumed by the order screen and the cron) ---------- */

  createWaybill(input: CreateWaybillInput): Promise<CreatedWaybill>;
  /** Works until the parcel is accepted at the branch; throws after. */
  deleteWaybill(documentRef: string): Promise<void>;
  /** Batched by the adapter; any number of waybill numbers is fine. */
  trackWaybills(numbers: readonly string[]): Promise<WaybillTracking[]>;
  /**
   * The carrier's print URL **with the API key in it** — never render it into
   * a page; the admin Worker's proxy route fetches it server-side.
   */
  waybillPrintUrl(documentRef: string, kind: WaybillPrintKind): string;

  /* --- the register of shipments (NP-5's screen, NP-2's calls) ------------- */

  createScanSheet(documentRefs: readonly string[]): Promise<ScanSheetInfo>;
  /** Take single waybills off a register without deleting the register. */
  removeFromScanSheet(scanSheetRef: string, documentRefs: readonly string[]): Promise<void>;
  deleteScanSheet(scanSheetRef: string): Promise<void>;
  /** Same warning as `waybillPrintUrl`: the key rides in the URL. */
  scanSheetPrintUrl(scanSheetRef: string): string;
}

/**
 * The slice of `ShippingPort` that Nova Poshta operations actually implement
 * today. The first three methods above predate this work and have no adapter —
 * checkout reads the synced `np_settlements`/`np_warehouses` tables instead,
 * and `quote` is a recorded decision *not* to quote — so the factory in
 * `novaposhta/shipping.ts` returns this subset rather than pretending.
 */
export type WaybillOps = Pick<
  ShippingPort,
  | 'createWaybill'
  | 'deleteWaybill'
  | 'trackWaybills'
  | 'waybillPrintUrl'
  | 'createScanSheet'
  | 'removeFromScanSheet'
  | 'deleteScanSheet'
  | 'scanSheetPrintUrl'
>;

/* ------------------------------------------------------------ notifications */

export interface OrderNotification {
  order: Order;
  items: readonly OrderItem[];
}

/**
 * Best-effort by contract: implementations must not throw into the checkout
 * path. Log and swallow — a failed Telegram message never costs us an order.
 */
export interface NotifierPort {
  orderCreated(notification: OrderNotification): Promise<void>;
  orderPaid(notification: OrderNotification): Promise<void>;
  /**
   * Money arrived for an order that is already `cancelled` — the one webhook
   * outcome that must never pass silently, because nothing downstream will
   * ever look at the order again. Manager-facing only: the customer must not
   * receive an order *confirmation* for a cancelled order, so the email
   * adapter implements this as a no-op and Telegram carries the alert.
   */
  paymentAfterCancellation(notification: OrderNotification): Promise<void>;
}

/* ------------------------------------------------------------ bot protection */

export interface CaptchaPort {
  verify(token: string, remoteIp?: string): Promise<boolean>;
}
