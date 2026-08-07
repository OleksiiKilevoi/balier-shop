import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../index';
import type { Order } from '../schema';
import { npScanSheets, orders } from '../schema';

/**
 * Read queries for `/registers` — the register list and one register's
 * contents. The writes live in `orders/register.ts`, transactional and under
 * `FOR UPDATE`, like every other order write.
 */

export interface ScanSheetListRow {
  ref: string;
  number: string;
  createdAt: Date;
  /** Orders still linked — drops as waybills detach, 0 for an emptied register. */
  orderCount: number;
}

export async function listScanSheets(db: Db): Promise<ScanSheetListRow[]> {
  return db
    .select({
      ref: npScanSheets.ref,
      number: npScanSheets.number,
      createdAt: npScanSheets.createdAt,
      orderCount: sql<number>`count(${orders.id})::int`,
    })
    .from(npScanSheets)
    .leftJoin(orders, eq(orders.npScanSheetRef, npScanSheets.ref))
    .groupBy(npScanSheets.ref)
    .orderBy(desc(npScanSheets.createdAt));
}

/**
 * The slice of the selected orders that `registerEligible` reads, plus the
 * waybill ref the carrier call takes. The pre-carrier check — the live rows
 * are re-checked again under `FOR UPDATE` in `attachRegister`.
 */
export interface RegisterCandidateRow {
  orderNumber: string;
  status: Order['status'];
  npTtnRef: string | null;
  npScanSheetRef: string | null;
}

export async function listOrdersByNumbers(
  db: Db,
  orderNumbers: readonly string[],
): Promise<RegisterCandidateRow[]> {
  if (orderNumbers.length === 0) return [];
  return db
    .select({
      orderNumber: orders.orderNumber,
      status: orders.status,
      npTtnRef: orders.npTtnRef,
      npScanSheetRef: orders.npScanSheetRef,
    })
    .from(orders)
    .where(inArray(orders.orderNumber, [...orderNumbers]));
}

/** One line of a register's contents — what the handover sheet is about. */
export interface ScanSheetOrderRow {
  orderNumber: string;
  status: Order['status'];
  customerName: string;
  paymentMethod: Order['paymentMethod'];
  total: number;
  npTtn: string | null;
  npTtnRef: string | null;
  npWarehouseName: string | null;
  npSettlementName: string | null;
}

export interface ScanSheetDetail {
  ref: string;
  number: string;
  createdAt: Date;
  orders: ScanSheetOrderRow[];
}

export async function getScanSheet(db: Db, ref: string): Promise<ScanSheetDetail | null> {
  const [sheet] = await db.select().from(npScanSheets).where(eq(npScanSheets.ref, ref)).limit(1);
  if (!sheet) return null;

  const rows = await db
    .select({
      orderNumber: orders.orderNumber,
      status: orders.status,
      customerName: orders.customerName,
      paymentMethod: orders.paymentMethod,
      total: orders.total,
      npTtn: orders.npTtn,
      npTtnRef: orders.npTtnRef,
      npWarehouseName: orders.npWarehouseName,
      npSettlementName: orders.npSettlementName,
    })
    .from(orders)
    .where(eq(orders.npScanSheetRef, ref))
    .orderBy(orders.orderNumber);

  return { ref: sheet.ref, number: sheet.number, createdAt: sheet.createdAt, orders: rows };
}
