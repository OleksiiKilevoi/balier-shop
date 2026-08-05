import { eq, sql } from 'drizzle-orm';
import type { TxDb } from '~/lib/db';
import { lockCheckoutVariants } from '~/lib/db/queries/cart';
import type { Order, OrderItem } from '~/lib/db/schema';
import { orderItems, orders, payments, productVariants, stockReservations } from '~/lib/db/schema';
import type { Kopiykas } from '~/lib/money';
import type { NotifierPort, PaymentPort } from '~/lib/ports';
import type { CartItemInput } from '~/lib/validation/cart';
import type { DeliveryInput } from '~/lib/validation/checkout';
import { type CheckoutLine, type CheckoutNotice, resolveCheckoutCart } from './checkoutCart';
import { generateOrderNumber } from './orderNumber';

/**
 * Places an order: resolve-and-lock the cart, reserve stock, and (for card)
 * create the Monobank invoice — the transactional shape described in
 * `docs/CONVENTIONS.md` ("Orders" + "Idempotency") and in the checkout plan.
 *
 * The order row is always inserted `pending` first, *before* Monobank is ever
 * called — required by the hard rule, and also what makes the payment-failure
 * path below safe to build: there is always an order to cancel and a
 * reservation to release, never a half-created order.
 */

export interface CreateOrderInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  delivery: DeliveryInput;
  paymentMethod: 'card' | 'cod';
  comment?: string;
  items: CartItemInput[];
}

export interface CreateOrderDeps {
  payment: PaymentPort;
  /** Manager-facing Telegram notifications. */
  notifier: NotifierPort;
  /**
   * Customer-facing order-confirmation email. Same `NotifierPort` shape as
   * `notifier`, but its `orderCreated` only actually sends for `cod` — a card
   * order isn't confirmed until `orderPaid` fires from the webhook (see
   * `src/lib/notify/email.ts`).
   */
  email: NotifierPort;
  /**
   * Origin the customer's browser is actually on — e.g. `http://localhost:4321`
   * or `https://balier.mlosko.dev` — used to build the
   * post-checkout redirect (`/checkout/success`). Deliberately request-derived
   * rather than a fixed site URL, so the redirect works wherever this is being
   * tested from.
   */
  redirectBaseUrl: string;
  /**
   * Where Monobank calls back. Also request-derived (same origin as
   * `redirectBaseUrl`) rather than a fixed site URL: `PUBLIC_SITE_URL`
   * (`balier.ua`) isn't deployed yet, so pinning the webhook to it meant
   * Monobank's server-to-server call had nowhere real to land and orders sat
   * in `awaiting_payment` forever, even against the deployed dev Worker. This
   * still needs a real, internet-reachable address — Monobank's servers hit
   * it, not the customer's browser — which is why plain `localhost` testing
   * still needs a tunnel; testing against `balier-dev.workers.dev` now works
   * without one.
   */
  webhookUrl: string;
  reservationTtlMinutes: number;
  codLimitKopiykas: Kopiykas;
}

export type CreateOrderResult =
  | { ok: true; orderNumber: string; redirectUrl: string }
  | { ok: false; reason: 'cart_changed'; notices: CheckoutNotice[] }
  | { ok: false; reason: 'cod_over_limit' }
  | { ok: false; reason: 'payment_failed' };

const ORDER_NUMBER_ATTEMPTS = 5;
const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

function successUrl(siteUrl: string, orderNumber: string): string {
  const url = new URL('/checkout/success', siteUrl);
  url.searchParams.set('order', orderNumber);
  return url.toString();
}

interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  total: Kopiykas;
  lines: CheckoutLine[];
  order: Order;
  items: OrderItem[];
}

export async function createOrder(
  txDb: TxDb,
  input: CreateOrderInput,
  deps: CreateOrderDeps,
): Promise<CreateOrderResult> {
  const variantIds = input.items.map((item) => item.variantId);

  let failure: CreateOrderResult | null = null;
  let created: CreatedOrder | undefined;

  for (let attempt = 0; attempt < ORDER_NUMBER_ATTEMPTS && !created; attempt++) {
    const orderNumber = generateOrderNumber();

    try {
      created = await txDb.transaction(async (tx) => {
        const variants = await lockCheckoutVariants(tx, variantIds);
        const resolved = resolveCheckoutCart(input.items, variants);

        if (!resolved.ok) {
          failure = { ok: false, reason: 'cart_changed', notices: resolved.notices };
          tx.rollback();
          throw new Error('unreachable: tx.rollback() throws');
        }

        if (input.paymentMethod === 'cod' && resolved.itemsTotal > deps.codLimitKopiykas) {
          failure = { ok: false, reason: 'cod_over_limit' };
          tx.rollback();
          throw new Error('unreachable: tx.rollback() throws');
        }

        const delivery = input.delivery;
        const deliveryFields =
          delivery.deliveryMethod === 'np_courier'
            ? { npWarehouseRef: null, npWarehouseName: null, npAddress: delivery.npAddress }
            : {
                npWarehouseRef: delivery.npWarehouseRef,
                npWarehouseName: delivery.npWarehouseName,
                npAddress: null,
              };

        const [order] = await tx
          .insert(orders)
          .values({
            orderNumber,
            status: 'pending',
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            customerEmail: input.customerEmail ?? null,
            deliveryMethod: delivery.deliveryMethod,
            npSettlementRef: delivery.npSettlementRef,
            npSettlementName: delivery.npSettlementName,
            ...deliveryFields,
            paymentMethod: input.paymentMethod,
            itemsTotal: resolved.itemsTotal,
            deliveryTotal: 0,
            total: resolved.itemsTotal,
            comment: input.comment ?? null,
          })
          .returning();

        if (!order) throw new Error('order insert returned no row');

        const items = await tx
          .insert(orderItems)
          .values(
            resolved.lines.map((line) => ({
              orderId: order.id,
              variantId: line.variantId,
              productSlug: line.productSlug,
              productTitle: line.productTitle,
              variantName: line.variantName,
              sku: line.sku,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              lineTotal: line.lineTotal,
            })),
          )
          .returning();

        const expiresAt = new Date(Date.now() + deps.reservationTtlMinutes * 60_000);
        await tx.insert(stockReservations).values(
          resolved.lines.map((line) => ({
            orderId: order.id,
            variantId: line.variantId,
            quantity: line.quantity,
            expiresAt,
          })),
        );

        // Cash on delivery waits on nothing — commit the sale immediately
        // instead of holding a reservation for a payment that never happens.
        let finalOrder = order;
        if (input.paymentMethod === 'cod') {
          for (const line of resolved.lines) {
            await tx
              .update(productVariants)
              .set({ stock: sql`${productVariants.stock} - ${line.quantity}`, updatedAt: sql`now()` })
              .where(eq(productVariants.id, line.variantId));
          }
          await tx.delete(stockReservations).where(eq(stockReservations.orderId, order.id));
          const [updated] = await tx
            .update(orders)
            .set({ status: 'confirmed', updatedAt: sql`now()` })
            .where(eq(orders.id, order.id))
            .returning();
          if (!updated) throw new Error('order update returned no row');
          finalOrder = updated;
        }

        return {
          orderId: order.id,
          orderNumber,
          total: resolved.itemsTotal,
          lines: resolved.lines,
          order: finalOrder,
          items,
        };
      });
    } catch (err) {
      if (failure) break; // an intentional rollback above, not a DB error
      if (isUniqueViolation(err)) continue; // order number collided — try a fresh one
      throw err;
    }
  }

  if (failure) return failure;
  if (!created) throw new Error('createOrder: exhausted order-number attempts');

  if (input.paymentMethod === 'cod') {
    await deps.notifier.orderCreated({ order: created.order, items: created.items });
    await deps.email.orderCreated({ order: created.order, items: created.items });
    return {
      ok: true,
      orderNumber: created.orderNumber,
      redirectUrl: successUrl(deps.redirectBaseUrl, created.orderNumber),
    };
  }

  // Card: the order sits `pending` with its reservation. Monobank is called
  // *outside* the transaction above — a network call must never hold a DB
  // transaction open.
  try {
    const invoice = await deps.payment.createInvoice({
      orderNumber: created.orderNumber,
      amount: created.total,
      items: created.lines.map((line) => ({
        productTitle: line.productTitle,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        sku: line.sku,
      })),
      redirectUrl: successUrl(deps.redirectBaseUrl, created.orderNumber),
      webhookUrl: deps.webhookUrl,
      validitySeconds: deps.reservationTtlMinutes * 60,
    });

    const [updatedOrder] = await txDb.transaction(async (tx) => {
      await tx.insert(payments).values({
        orderId: created!.orderId,
        invoiceId: invoice.invoiceId,
        status: 'created',
        amount: created!.total,
        // Kept so the link can be shown again later. A storefront customer is
        // redirected to it immediately and never needs it twice, but an order
        // created in the admin panel has no browser to redirect — the manager
        // sends this to someone on Telegram, and may need it again.
        pageUrl: invoice.pageUrl,
      });
      return tx
        .update(orders)
        .set({ status: 'awaiting_payment', updatedAt: sql`now()` })
        .where(eq(orders.id, created!.orderId))
        .returning();
    });
    if (!updatedOrder) throw new Error('order update returned no row');

    await deps.notifier.orderCreated({ order: updatedOrder, items: created.items });
    await deps.email.orderCreated({ order: updatedOrder, items: created.items });

    return { ok: true, orderNumber: created.orderNumber, redirectUrl: invoice.pageUrl };
  } catch {
    // The invoice call failed — release the hold rather than leave stock
    // silently reserved against a payment that was never actually offered.
    await txDb.transaction(async (tx) => {
      await tx.delete(stockReservations).where(eq(stockReservations.orderId, created!.orderId));
      await tx
        .update(orders)
        .set({ status: 'cancelled', cancelledAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(orders.id, created!.orderId));
    });

    return { ok: false, reason: 'payment_failed' };
  }
}
