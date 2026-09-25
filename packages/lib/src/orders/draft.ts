import { paymentMethod } from '../db/schema';
import type { DeliveryMethod, PaymentMethod } from '../db/schema';
import { phoneDigitsFromInput } from '../phone';
import { MAX_CART_LINES, MAX_ITEM_QUANTITY } from '../validation/cart';
import type { CartItemInput } from '../validation/cart';
import { MAX_COMMENT_LENGTH, MAX_CUSTOMER_NAME } from '../validation/checkout';

/**
 * The order a manager is composing at `/admin/orders/new`, and the two pure
 * functions that move it along.
 *
 * WHERE THE DRAFT LIVES: in the form itself. Every field below is rendered as
 * an input — visible or hidden — inside one big `<form method="post">`, so the
 * whole draft is re-submitted on every click and the server is a pure function
 * of the request body. That is what lets the panel keep its no-JavaScript rule
 * while still offering three search-and-pick affordances (products, settlement,
 * warehouse): each search is just a submit that re-renders the same page with
 * everything the manager had typed still in it.
 *
 * It also means there is no draft *storage* — no table, no KV entry, no session
 * key, nothing to expire or clean up — and no customer name or phone number in
 * a URL, a browser history entry or a Worker log line, which is what carrying
 * the draft in the query string would have cost.
 *
 * The consequence to know about: a draft only exists in the open tab. Navigate
 * away and it is gone. That is the same deal as any unsubmitted form, and the
 * alternative was persisting half-typed orders somewhere.
 *
 * Every function here is total: nothing in a form body is trusted, and anything
 * unparseable degrades to a sensible empty value rather than throwing. The page
 * must always render, even when the body was hand-forged — the strict check
 * that decides whether an order may actually be created is
 * `adminNewOrderSchema` in `~/lib/validation/admin.ts`, not this file.
 */

export interface DraftItem {
  variantId: string;
  quantity: number;
}

export interface OrderDraft {
  customerName: string;
  /**
   * The 9 local digits after `+380`, the same thing `/checkout`'s masked field
   * carries: the country code is a fixed prefix in the UI on both pages, so it
   * never travels in the body. `new.astro` puts it back before validating —
   * `customerPhoneSchema` is what wants the full `+380XXXXXXXXX`.
   */
  customerPhoneDigits: string;
  customerEmail: string;
  comment: string;

  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;

  /** Nova Poshta settlement ref. NULL until one is picked. */
  settlementRef: string | null;
  /** Warehouse/postomat ref. NULL until one is picked. */
  warehouseRef: string | null;

  items: DraftItem[];

  /** The three search boxes, kept so results survive the next submit. */
  productQuery: string;
  settlementQuery: string;
  warehouseQuery: string;
}

/** Field names, in one place, so the page and the parser cannot drift. */
export const DRAFT_FIELDS = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  comment: 'comment',
  paymentMethod: 'pm',
  deliveryMethod: 'dm',
  settlement: 'city',
  warehouse: 'wh',
  /** Repeated once per basket line, holding the variant id. */
  item: 'i',
  /** Prefix for a line's quantity input — `q:<variantId>`. */
  quantityPrefix: 'q:',
  productQuery: 'pq',
  settlementQuery: 'cq',
  warehouseQuery: 'wq',
} as const;

/**
 * The buttons that change the draft rather than just re-rendering it. Each
 * carries its target as the button's own value (`name="add" value="<uuid>"`),
 * which is the only part of a form a browser submits per-button — so a list of
 * twenty search results needs twenty buttons and no hidden bookkeeping.
 *
 * A submit that matches none of these is a search: the body is read, the page
 * re-renders, nothing moves. That is deliberately also what pressing Enter in
 * any text field does.
 */
export const DRAFT_ACTIONS = {
  add: 'add',
  remove: 'remove',
  pickSettlement: 'pick_city',
  pickWarehouse: 'pick_wh',
  create: 'create',
} as const;

const PAYMENT_METHODS = new Set<string>(paymentMethod.enumValues);

/**
 * The delivery methods a form may still choose — deliberately narrower than
 * `delivery_method`'s enum.
 *
 * `np_courier` is still a valid *stored* value, because orders placed before
 * courier was withdrawn (2026-08-06) have to keep loading and rendering. It is
 * not a valid *incoming* one: a form naming it now is stale or forged, and
 * accepting it would produce a draft with no radio to check and a delivery
 * shape `adminNewOrderSchema` rejects. It falls back to the default instead.
 */
export const SELECTABLE_DELIVERY_METHODS = ['np_warehouse', 'np_postomat'] as const;

const DELIVERY_METHODS = new Set<string>(SELECTABLE_DELIVERY_METHODS);

/** Cash on delivery is what a Telegram order usually is; card is the deliberate choice. */
const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'cod';
const DEFAULT_DELIVERY_METHOD: DeliveryMethod = 'np_warehouse';

/** A search box's contents. Long enough for an address, short enough to bound. */
const MAX_QUERY_LENGTH = 100;
/** Refs are Nova Poshta GUIDs; this only stops an absurd body, nothing else. */
const MAX_REF_LENGTH = 64;

function text(form: FormData, field: string, max: number): string {
  const value = form.get(field);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function ref(form: FormData, field: string): string | null {
  const value = text(form, field, MAX_REF_LENGTH);
  return value === '' ? null : value;
}

/**
 * Lines, in the order the manager added them.
 *
 * Ids come from the repeated `i` inputs and quantities from the sibling
 * `q:<id>` number input, rather than from one packed `id:qty` value — so the
 * quantity is a real editable field the browser validates, and a manager
 * re-typing one and then hitting *search* keeps the change. A missing or
 * unparseable quantity is 1: the manager can see and fix a wrong number, but a
 * dropped line is invisible.
 *
 * Duplicate ids are folded rather than repeated — `addDraftItem` bumps an
 * existing line, so two lines for one variant can only come from a forged body,
 * and two lines would then make the basket disagree with the order it creates.
 */
function items(form: FormData): DraftItem[] {
  const byId = new Map<string, DraftItem>();

  for (const raw of form.getAll(DRAFT_FIELDS.item)) {
    if (typeof raw !== 'string') continue;
    const variantId = raw.trim();
    if (variantId === '' || byId.has(variantId)) continue;
    if (byId.size >= MAX_CART_LINES) break;

    byId.set(variantId, {
      variantId,
      quantity: quantity(form.get(`${DRAFT_FIELDS.quantityPrefix}${variantId}`)),
    });
  }

  return [...byId.values()];
}

function quantity(raw: FormDataEntryValue | null): number {
  if (typeof raw !== 'string') return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), MAX_ITEM_QUANTITY);
}

/** Reads a draft out of a submitted form body. Never throws. */
export function readDraft(form: FormData): OrderDraft {
  const rawPayment = text(form, DRAFT_FIELDS.paymentMethod, 32);
  const rawDelivery = text(form, DRAFT_FIELDS.deliveryMethod, 32);

  const method = DELIVERY_METHODS.has(rawDelivery)
    ? (rawDelivery as DeliveryMethod)
    : DEFAULT_DELIVERY_METHOD;

  return {
    customerName: text(form, DRAFT_FIELDS.name, MAX_CUSTOMER_NAME),
    // The field is masked in the browser, but the mask is script — this is
    // what makes the digits the same nine whether they arrived formatted,
    // typed as `0XX…` with no script at all, or pasted as a full `+380XXX…`.
    customerPhoneDigits: phoneDigitsFromInput(text(form, DRAFT_FIELDS.phone, 32)),
    customerEmail: text(form, DRAFT_FIELDS.email, 320),
    comment: text(form, DRAFT_FIELDS.comment, MAX_COMMENT_LENGTH),

    paymentMethod: PAYMENT_METHODS.has(rawPayment)
      ? (rawPayment as PaymentMethod)
      : DEFAULT_PAYMENT_METHOD,
    deliveryMethod: method,

    settlementRef: ref(form, DRAFT_FIELDS.settlement),
    // Kept whatever the delivery method currently is, so toggling «відділення»
    // ⇄ «поштомат» to check something does not throw away the branch already
    // picked. Whether it is still a *valid* branch for the chosen method is
    // decided by resolving the ref against `np_warehouses` at render time —
    // switching leaves a ref that no longer matches.
    warehouseRef: ref(form, DRAFT_FIELDS.warehouse),

    items: items(form),

    productQuery: text(form, DRAFT_FIELDS.productQuery, MAX_QUERY_LENGTH),
    settlementQuery: text(form, DRAFT_FIELDS.settlementQuery, MAX_QUERY_LENGTH),
    warehouseQuery: text(form, DRAFT_FIELDS.warehouseQuery, MAX_QUERY_LENGTH),
  };
}

/**
 * Adds one unit of a variant, or bumps the line that is already there.
 *
 * Silently does nothing once the basket is full or the line is at its ceiling —
 * both are the same limits `cartItemsSchema` enforces on a customer's cart, and
 * the page shows the count, so a manager who hits either can see why.
 */
export function addDraftItem(draft: OrderDraft, variantId: string): OrderDraft {
  const existing = draft.items.find((item) => item.variantId === variantId);

  if (existing) {
    return {
      ...draft,
      items: draft.items.map((item) =>
        item.variantId === variantId
          ? { ...item, quantity: Math.min(item.quantity + 1, MAX_ITEM_QUANTITY) }
          : item,
      ),
    };
  }

  if (draft.items.length >= MAX_CART_LINES) return draft;

  return { ...draft, items: [...draft.items, { variantId, quantity: 1 }] };
}

export function removeDraftItem(draft: OrderDraft, variantId: string): OrderDraft {
  return { ...draft, items: draft.items.filter((item) => item.variantId !== variantId) };
}

/**
 * Picking a settlement drops the chosen branch: a warehouse ref belongs to one
 * settlement, so keeping it would leave the order pointing at a branch in the
 * city the manager just navigated away from. The warehouse search box is
 * cleared with it, since its results were for that other city too.
 *
 * Its own search box is cleared too, and that is what closes the dropdown: the
 * box doubles as the display of what is picked (`isSearchQuery`), so an empty
 * query means "showing the chosen row", not "searching for nothing".
 */
export function pickSettlement(draft: OrderDraft, settlementRef: string): OrderDraft {
  if (settlementRef === draft.settlementRef) return { ...draft, settlementQuery: '' };
  return {
    ...draft,
    settlementRef,
    settlementQuery: '',
    warehouseRef: null,
    warehouseQuery: '',
  };
}

export function pickWarehouse(draft: OrderDraft, warehouseRef: string): OrderDraft {
  return { ...draft, warehouseRef, warehouseQuery: '' };
}

/**
 * Whether a search box is being *searched in*, rather than displaying what has
 * already been picked.
 *
 * The settlement and branch boxes are single inputs with a dropdown under them,
 * the same shape `/checkout` uses: picking a row writes its label into the box,
 * and typing over that label is how a manager starts looking for a different
 * one. So the box carries two meanings, and this is the rule that tells them
 * apart — the label exactly as rendered means "still picked" (an untouched
 * field is submitted back on every click), anything else is a query, and a
 * query un-picks.
 *
 * `pickedLabel` is null when nothing is picked, in which case any non-empty box
 * is a search.
 */
export function isSearchQuery(query: string, pickedLabel: string | null): boolean {
  return query !== '' && query !== pickedLabel;
}

/**
 * Applies whichever action button was clicked. Returns the draft unchanged for
 * a plain search submit — which is most of them.
 */
export function applyDraftAction(draft: OrderDraft, form: FormData): OrderDraft {
  const value = (action: string): string | null => {
    const raw = form.get(action);
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim().slice(0, MAX_REF_LENGTH);
    return trimmed === '' ? null : trimmed;
  };

  const add = value(DRAFT_ACTIONS.add);
  if (add) return addDraftItem(draft, add);

  const remove = value(DRAFT_ACTIONS.remove);
  if (remove) return removeDraftItem(draft, remove);

  const settlement = value(DRAFT_ACTIONS.pickSettlement);
  if (settlement) return pickSettlement(draft, settlement);

  const warehouse = value(DRAFT_ACTIONS.pickWarehouse);
  if (warehouse) return pickWarehouse(draft, warehouse);

  return draft;
}

/** True when the submit that arrived is the one that actually places the order. */
export function isCreateSubmit(form: FormData): boolean {
  return form.has(DRAFT_ACTIONS.create);
}

/** The draft's basket in the shape `createOrder` and its validation expect. */
export function draftCartItems(draft: OrderDraft): CartItemInput[] {
  return draft.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
}
