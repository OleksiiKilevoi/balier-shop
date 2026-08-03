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
   * hint that something changed — always confirm through this.
   */
  getInvoiceStatus(invoiceId: string): Promise<{ status: InvoiceStatus; amount: Kopiykas }>;
  /** Verifies the raw request body against the provider signature header. */
  verifyWebhook(rawBody: string, signature: string | null): Promise<boolean>;
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
}

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
}

/* ------------------------------------------------------------ bot protection */

export interface CaptchaPort {
  verify(token: string, remoteIp?: string): Promise<boolean>;
}
