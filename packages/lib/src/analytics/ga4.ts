/**
 * GA4 e-commerce payloads (`view_item`, `add_to_cart`, `begin_checkout`,
 * `purchase`), built here so the storefront pages only assemble inputs and the
 * shapes are tested. `item_id` is the SKU — the same id the Merchant Center
 * feed sends as `g:id` — so GA4's item reports and Google Ads agree on what a
 * product is. Money arrives in kopiykas and leaves in hryvnias, as GA4 wants.
 */
import type { Kopiykas } from '../money';

export interface Ga4Item {
  item_id: string;
  item_name: string;
  item_variant?: string;
  item_category?: string;
  price: number;
  quantity: number;
}

export const GA4_CURRENCY = 'UAH';

/** Kopiykas to hryvnias, kept exact: 999 950 → 9999.5. */
export function hryvniaValue(amount: Kopiykas): number {
  return amount / 100;
}

export function ga4Item(input: {
  sku: string;
  title: string;
  variantName: string | null;
  categoryTitle: string | null;
  unitPrice: Kopiykas;
  quantity: number;
}): Ga4Item {
  const item: Ga4Item = {
    item_id: input.sku,
    item_name: input.title,
    price: hryvniaValue(input.unitPrice),
    quantity: input.quantity,
  };
  if (input.variantName) item.item_variant = input.variantName;
  if (input.categoryTitle) item.item_category = input.categoryTitle;
  return item;
}

/** A cart line, at the price the cart will actually charge for it. */
export function cartLineItem(line: {
  sku: string;
  productTitle: string;
  variantName: string | null;
  unitPrice: Kopiykas;
  bundleUnitPrice: Kopiykas;
  quantity: number;
}): Ga4Item {
  return ga4Item({
    sku: line.sku,
    title: line.productTitle,
    variantName: line.variantName,
    categoryTitle: null,
    unitPrice: line.bundleUnitPrice,
    quantity: line.quantity,
  });
}

/** A stored order line (`order_items`). */
export function orderLineItem(item: {
  sku: string;
  productTitle: string;
  variantName: string | null;
  unitPrice: Kopiykas;
  quantity: number;
}): Ga4Item {
  return ga4Item({
    sku: item.sku,
    title: item.productTitle,
    variantName: item.variantName,
    categoryTitle: null,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
  });
}

export interface PurchaseParams {
  transaction_id: string;
  value: number;
  currency: string;
  coupon?: string;
  items: Ga4Item[];
}

export function purchaseParams(order: {
  orderNumber: string;
  total: Kopiykas;
  promoCode: string | null;
  items: readonly Parameters<typeof orderLineItem>[0][];
}): PurchaseParams {
  const params: PurchaseParams = {
    transaction_id: order.orderNumber,
    value: hryvniaValue(order.total),
    currency: GA4_CURRENCY,
    items: order.items.map(orderLineItem),
  };
  if (order.promoCode) params.coupon = order.promoCode;
  return params;
}

export function checkoutParams(summary: {
  itemsTotal: Kopiykas;
  lines: readonly Parameters<typeof cartLineItem>[0][];
}): { value: number; currency: string; items: Ga4Item[] } {
  return {
    value: hryvniaValue(summary.itemsTotal),
    currency: GA4_CURRENCY,
    items: summary.lines.map(cartLineItem),
  };
}
