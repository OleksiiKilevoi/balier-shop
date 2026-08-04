import type { Db, Tx, TxDb } from '../index';
import type { Order, OrderItem, Payment } from '../schema';

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

/** `/checkout/success`: the order plus its snapshotted line items. */
export async function findOrderByNumber(
  db: Db | TxDb | Tx,
  orderNumber: string,
): Promise<OrderWithItems | null> {
  const order = await db.query.orders.findFirst({
    where: (orders, { eq: eqCol }) => eqCol(orders.orderNumber, orderNumber),
    with: { items: true },
  });
  return order ?? null;
}

export interface PaymentWithOrder extends Payment {
  order: OrderWithItems;
}

/** The webhook's entry point: which order does this `invoiceId` belong to. */
export async function findPaymentByInvoiceId(
  db: Db | TxDb | Tx,
  invoiceId: string,
): Promise<PaymentWithOrder | null> {
  const payment = await db.query.payments.findFirst({
    where: (payments, { eq: eqCol }) => eqCol(payments.invoiceId, invoiceId),
    with: { order: { with: { items: true } } },
  });
  return payment ?? null;
}
