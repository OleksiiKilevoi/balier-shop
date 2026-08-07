import type { Kopiykas } from '../money';
import type { CreateWaybillInput, CreatedWaybill, WaybillPrintKind } from '../ports';
import type { NovaPoshtaClient } from './client';

/**
 * Waybills (ТТН / експрес-накладні) over `InternetDocument.save` and friends.
 *
 * Everything here is `WarehouseWarehouse`: courier delivery was withdrawn at
 * checkout on 2026-08-06, so the recipient side is always a branch or locker
 * ref that the order already carries (docs/plans/novaposhta.md).
 *
 * The payload builder is a pure function and carries the tests — this is the
 * file where a bug costs a parcel, not a screen. There is **no sandbox for
 * API 2.0** (checked 2026-08-07, recorded in the plan), so everything that
 * talks to the network here creates real documents on the real account;
 * driving it means create-then-delete, and deletion stops working the moment
 * the branch accepts the parcel.
 */

/* ------------------------------------------------------------- conversions */

/**
 * Kopiykas → the decimal-string hryvnias the API wants. Exact, not rounded:
 * for cash on delivery this number is the money the carrier pays out, and a
 * kopiyka dropped here is a kopiyka the client argues about later.
 */
export function toUahString(amount: Kopiykas): string {
  const uah = Math.trunc(amount / 100);
  const cents = Math.abs(amount % 100);
  return cents === 0 ? String(uah) : `${uah}.${String(cents).padStart(2, '0')}`;
}

/** Grams → kilogram string: `1250` → `"1.25"`. No clamping — a weight the
 * carrier would refuse (they floor at 0.1 kg) should be refused out loud, not
 * silently inflated here. */
export function toKgString(grams: number): string {
  return String(grams / 1000);
}

/**
 * «Прізвище Ім'я [По батькові]» → its parts, or null when there is only one
 * word — checkout demands two characters, not two words, so an order from
 * «Аня» is real and cannot produce a waybill until the operator fills the
 * name in properly. The *order* is never touched; the split feeds the form.
 */
export function splitRecipientName(
  raw: string,
): { lastName: string; firstName: string; middleName: string | null } | null {
  const parts = raw.trim().split(/\s+/);
  const lastName = parts[0];
  const firstName = parts[1];
  if (!lastName || !firstName) return null;
  return {
    lastName,
    firstName,
    middleName: parts.length > 2 ? parts.slice(2).join(' ') : null,
  };
}

/** Today in Kyiv as `dd.mm.yyyy` — the API refuses a `DateTime` in the past,
 * and the Worker's UTC clock crosses midnight two-to-three hours early. */
export function kyivToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

/* ----------------------------------------------------------- the recipient */

export interface RecipientRefs {
  counterpartyRef: string;
  contactRef: string;
}

interface RawCounterpartySave {
  Ref: string;
  ContactPerson?: { data?: { Ref: string }[] };
}

/**
 * A recipient counterparty must exist before a waybill can name it, so one is
 * created (or re-matched — NP dedupes private persons by phone+name on its
 * side) per waybill creation. Not persisted on our side on purpose: the refs
 * are NP's index of *their* records, the order already holds the true data,
 * and caching them would only add a place for a renamed customer to go stale.
 */
export async function ensureRecipient(
  client: NovaPoshtaClient,
  recipient: { lastName: string; firstName: string; middleName?: string | null; phone: string },
): Promise<RecipientRefs> {
  const [row] = await client.call<RawCounterpartySave>({
    modelName: 'Counterparty',
    calledMethod: 'save',
    methodProperties: {
      CounterpartyType: 'PrivatePerson',
      CounterpartyProperty: 'Recipient',
      FirstName: recipient.firstName,
      LastName: recipient.lastName,
      MiddleName: recipient.middleName ?? '',
      Phone: recipient.phone,
    },
  });

  const contactRef = row?.ContactPerson?.data?.[0]?.Ref;
  if (!row?.Ref || !contactRef) {
    throw new Error('Nova Poshta Counterparty.save returned no recipient refs');
  }
  return { counterpartyRef: row.Ref, contactRef };
}

/* -------------------------------------------------------------- the payload */

/**
 * The `InternetDocument.save` body, pure and testable. `date` is injected
 * rather than read from the clock so the tests are not a function of when they
 * run; callers pass `kyivToday()`.
 *
 * Field names and shapes follow the API 2.0 docs; the ones worth re-verifying
 * against a live call before NP-3 relies on them are `OptionsSeat` (the plan's
 * open question on parcel-locker requirements) and `BackwardDeliveryData`
 * (untestable at all without a business contract).
 */
export function buildWaybillPayload(
  input: CreateWaybillInput,
  recipientRefs: RecipientRefs,
  date: string,
): Record<string, unknown> {
  const weightKg = toKgString(input.weightGrams);
  /* Each seat carries the shared default dimensions and an equal share of the
     weight — the panel asks for one weight and one box size, not per-box. The
     remainder grams go to the first seats so the seats sum exactly to `Weight`. */
  const seatBaseGrams = Math.floor(input.weightGrams / input.seats);
  const seatExtraGrams = input.weightGrams - seatBaseGrams * input.seats;
  const { length, width, height } = input.dimensionsCm;

  const payload: Record<string, unknown> = {
    ServiceType: 'WarehouseWarehouse',
    CargoType: 'Parcel',
    /* The recipient pays the carrier at the counter — the settled 2026-08-03
       decision that nothing about delivery enters an order total. */
    PayerType: 'Recipient',
    PaymentMethod: 'Cash',
    DateTime: date,

    Weight: weightKg,
    SeatsAmount: String(input.seats),
    OptionsSeat: Array.from({ length: input.seats }, (_, seat) => ({
      volumetricLength: String(length),
      volumetricWidth: String(width),
      volumetricHeight: String(height),
      /* Cubic METERS — the API documents this field in м³, not the /4000
         volumetric-weight formula in kg. Confusing the two inflates the
         declared volume 250× and the recipient's tariff with it. */
      volumetricVolume: String((length * width * height) / 1_000_000),
      weight: toKgString(seat < seatExtraGrams ? seatBaseGrams + 1 : seatBaseGrams),
    })),

    Description: input.description,
    Cost: toUahString(input.declaredValueKopiykas),

    CitySender: input.sender.cityRef,
    Sender: input.sender.counterpartyRef,
    SenderAddress: input.sender.warehouseRef,
    ContactSender: input.sender.contactRef,
    SendersPhone: input.sender.phone,

    CityRecipient: input.recipient.cityRef,
    Recipient: recipientRefs.counterpartyRef,
    RecipientAddress: input.recipient.warehouseRef,
    ContactRecipient: recipientRefs.contactRef,
    RecipientsPhone: input.recipient.phone,
  };

  if (input.codKopiykas !== null) {
    payload.BackwardDeliveryData = [
      {
        PayerType: 'Recipient',
        CargoType: 'Money',
        RedeliveryString: toUahString(input.codKopiykas),
      },
    ];
  }

  return payload;
}

/* ---------------------------------------------------------------- the calls */

interface RawInternetDocument {
  Ref: string;
  IntDocNumber: string;
  EstimatedDeliveryDate?: string;
}

export async function createWaybill(
  client: NovaPoshtaClient,
  input: CreateWaybillInput,
): Promise<CreatedWaybill> {
  const recipientRefs = await ensureRecipient(client, {
    lastName: input.recipient.lastName,
    firstName: input.recipient.firstName,
    middleName: input.recipient.middleName,
    phone: input.recipient.phone,
  });

  const [row] = await client.call<RawInternetDocument>({
    modelName: 'InternetDocument',
    calledMethod: 'save',
    methodProperties: buildWaybillPayload(input, recipientRefs, kyivToday()),
  });

  if (!row?.Ref || !row.IntDocNumber) {
    throw new Error('Nova Poshta InternetDocument.save returned no document');
  }

  return {
    ref: row.Ref,
    number: row.IntDocNumber,
    estimatedDeliveryDate: row.EstimatedDeliveryDate ?? null,
  };
}

/** Deletes at the carrier. Refused by NP once the branch has the parcel — the
 * error comes back as a thrown `client.call` failure, worded by them. */
export async function deleteWaybill(client: NovaPoshtaClient, documentRef: string): Promise<void> {
  await client.call({
    modelName: 'InternetDocument',
    calledMethod: 'delete',
    methodProperties: { DocumentRefs: [documentRef] },
  });
}

/* ----------------------------------------------------------------- printing */

/**
 * The carrier's own print endpoints, which take the API key **in the URL** —
 * the reason printing goes through the admin Worker's proxy route and one of
 * these strings must never reach a page (docs/plans/novaposhta.md,
 * «Constraints»).
 */
export function waybillPrintUrl(
  documentRef: string,
  kind: WaybillPrintKind,
  apiKey: string,
): string {
  const method = kind === 'marking' ? 'printMarking100x100' : 'printDocument';
  return `https://my.novaposhta.ua/orders/${method}/orders[]/${documentRef}/type/pdf/apiKey/${apiKey}`;
}
