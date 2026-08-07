import { phoneDigitsFromInput } from '../phone';
import type { NovaPoshtaClient } from './client';

/**
 * Who the API key belongs to, as Nova Poshta sees it — the sender counterparty
 * and its contact person. This is where the sender Refs on `/settings` come
 * from: they exist nowhere an admin could copy them by hand (the NP cabinet
 * shows names, never refs), so the screen fetches them with one button instead
 * of asking anyone to paste UUIDs.
 */
export interface SenderIdentity {
  counterpartyRef: string;
  /** «Приватна особа» for a personal account, the company name for a business one. */
  counterpartyName: string;
  contactRef: string;
  /** «Прізвище Ім'я По батькові» of the contact person. */
  contactName: string;
  /** The contact's phone, normalised to `+380XXXXXXXXX`; null when NP has none. */
  phone: string | null;
}

interface RawCounterparty {
  Ref: string;
  Description?: string;
}

interface RawContactPerson {
  Ref: string;
  Description?: string;
  Phones?: string;
}

/**
 * Returns null when the account simply has no sender counterparty yet — a
 * fresh key before any shipment — which the screen words as a state, not an
 * error. A key with several counterparties takes the first: the accounts this
 * shop will ever see have exactly one, and the screen shows the name it
 * picked, so a wrong guess is visible rather than silent.
 */
export async function fetchSenderIdentity(
  client: NovaPoshtaClient,
): Promise<SenderIdentity | null> {
  const [counterparty] = await client.call<RawCounterparty>({
    modelName: 'CounterpartyGeneral',
    calledMethod: 'getCounterparties',
    methodProperties: { CounterpartyProperty: 'Sender', Page: '1' },
  });
  if (!counterparty?.Ref) return null;

  const [contact] = await client.call<RawContactPerson>({
    modelName: 'CounterpartyGeneral',
    calledMethod: 'getCounterpartyContactPersons',
    methodProperties: { Ref: counterparty.Ref, Page: '1' },
  });
  if (!contact?.Ref) return null;

  const phoneDigits = phoneDigitsFromInput(contact.Phones ?? '');

  return {
    counterpartyRef: counterparty.Ref,
    counterpartyName: counterparty.Description ?? 'Відправник',
    contactRef: contact.Ref,
    contactName: contact.Description ?? '',
    phone: phoneDigits.length === 9 ? `+380${phoneDigits}` : null,
  };
}
