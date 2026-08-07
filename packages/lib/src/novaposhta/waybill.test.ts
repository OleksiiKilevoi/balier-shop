import { describe, expect, it, vi } from 'vitest';
import type { CreateWaybillInput } from '../ports';
import type { NovaPoshtaClient } from './client';
import {
  buildWaybillPayload,
  createWaybill,
  kyivToday,
  splitRecipientName,
  toKgString,
  toUahString,
  waybillPrintUrl,
} from './waybill';

/**
 * The payload builder is where a bug costs a parcel or a payment — the HTTP
 * layer already has its one `success:false` check in `client.ts`, so these
 * tests are about exact field values, the same way the money tests assert
 * exact kopiyka numbers rather than round trips.
 */

const INPUT: CreateWaybillInput = {
  sender: {
    counterpartyRef: 'sender-cp',
    contactRef: 'sender-contact',
    phone: '+380988974064',
    cityRef: 'sender-city',
    warehouseRef: 'sender-wh',
  },
  recipient: {
    lastName: 'Тестенко',
    firstName: 'Тест',
    phone: '+380501234567',
    cityRef: 'recipient-city',
    warehouseRef: 'recipient-wh',
  },
  weightGrams: 1250,
  seats: 1,
  dimensionsCm: { length: 30, width: 20, height: 10 },
  description: 'Аксесуари зі шкіри',
  declaredValueKopiykas: 195000,
  codKopiykas: null,
};

const RECIPIENT_REFS = { counterpartyRef: 'recipient-cp', contactRef: 'recipient-contact' };

function build(overrides: Partial<CreateWaybillInput> = {}) {
  return buildWaybillPayload({ ...INPUT, ...overrides }, RECIPIENT_REFS, '07.08.2026');
}

describe('toUahString', () => {
  it('is exact to the kopiyka — this string is what COD pays out', () => {
    expect(toUahString(185000)).toBe('1850');
    expect(toUahString(185050)).toBe('1850.50');
    expect(toUahString(185005)).toBe('1850.05');
    expect(toUahString(100)).toBe('1');
    expect(toUahString(5)).toBe('0.05');
  });
});

describe('toKgString', () => {
  it('converts grams without inventing precision', () => {
    expect(toKgString(1250)).toBe('1.25');
    expect(toKgString(1000)).toBe('1');
    expect(toKgString(100)).toBe('0.1');
    expect(toKgString(1170)).toBe('1.17');
  });
});

describe('splitRecipientName', () => {
  it('splits «Прізвище Ім’я [По батькові]»', () => {
    expect(splitRecipientName('Шулежко Михайло')).toEqual({
      lastName: 'Шулежко',
      firstName: 'Михайло',
      middleName: null,
    });
    expect(splitRecipientName('  Шулежко   Михайло   Олександрович ')).toEqual({
      lastName: 'Шулежко',
      firstName: 'Михайло',
      middleName: 'Олександрович',
    });
  });

  it('returns null for one word — «Аня» is a real order and not a waybill', () => {
    expect(splitRecipientName('Аня')).toBeNull();
    expect(splitRecipientName('   ')).toBeNull();
  });
});

describe('kyivToday', () => {
  it('rolls the date at Kyiv midnight, not UTC midnight', () => {
    // 22:30 UTC in August is 01:30 the NEXT day in Kyiv (UTC+3).
    expect(kyivToday(new Date('2026-08-07T22:30:00Z'))).toBe('08.08.2026');
    expect(kyivToday(new Date('2026-08-07T12:00:00Z'))).toBe('07.08.2026');
  });
});

describe('buildWaybillPayload', () => {
  it('is always warehouse→warehouse with the recipient paying the carrier', () => {
    const payload = build();
    expect(payload.ServiceType).toBe('WarehouseWarehouse');
    expect(payload.PayerType).toBe('Recipient');
    expect(payload.PaymentMethod).toBe('Cash');
    expect(payload.DateTime).toBe('07.08.2026');
  });

  it('wires both sides from the refs it was given', () => {
    const payload = build();
    expect(payload.CitySender).toBe('sender-city');
    expect(payload.Sender).toBe('sender-cp');
    expect(payload.SenderAddress).toBe('sender-wh');
    expect(payload.ContactSender).toBe('sender-contact');
    expect(payload.SendersPhone).toBe('+380988974064');
    expect(payload.CityRecipient).toBe('recipient-city');
    expect(payload.Recipient).toBe('recipient-cp');
    expect(payload.RecipientAddress).toBe('recipient-wh');
    expect(payload.ContactRecipient).toBe('recipient-contact');
    expect(payload.RecipientsPhone).toBe('+380501234567');
  });

  it('converts weight and declared value at the boundary, exactly', () => {
    const payload = build();
    expect(payload.Weight).toBe('1.25');
    expect(payload.Cost).toBe('1950');
    expect(payload.Description).toBe('Аксесуари зі шкіри');
  });

  it('renders one OptionsSeat per seat, sharing the weight', () => {
    const payload = build({ seats: 2, weightGrams: 2500 });
    expect(payload.SeatsAmount).toBe('2');
    const seats = payload.OptionsSeat as Record<string, string>[];
    expect(seats).toHaveLength(2);
    expect(seats[0]).toEqual({
      volumetricLength: '30',
      volumetricWidth: '20',
      volumetricHeight: '10',
      volumetricVolume: '1.5',
      weight: '1.25',
    });
  });

  it('adds backward delivery only for COD, with the exact amount', () => {
    expect(build().BackwardDeliveryData).toBeUndefined();

    const cod = build({ codKopiykas: 195050 });
    expect(cod.BackwardDeliveryData).toEqual([
      { PayerType: 'Recipient', CargoType: 'Money', RedeliveryString: '1950.50' },
    ]);
  });
});

describe('createWaybill', () => {
  function fakeClient(responses: unknown[][]): NovaPoshtaClient {
    const call = vi.fn();
    for (const response of responses) call.mockResolvedValueOnce(response);
    return { call } as unknown as NovaPoshtaClient;
  }

  it('creates the recipient first, then the document naming those refs', async () => {
    const client = fakeClient([
      [{ Ref: 'recipient-cp', ContactPerson: { data: [{ Ref: 'recipient-contact' }] } }],
      [{ Ref: 'doc-ref', IntDocNumber: '20450000000001', EstimatedDeliveryDate: '09.08.2026' }],
    ]);

    const created = await createWaybill(client, INPUT);
    expect(created).toEqual({
      ref: 'doc-ref',
      number: '20450000000001',
      estimatedDeliveryDate: '09.08.2026',
    });

    const requests = (client.call as ReturnType<typeof vi.fn>).mock.calls.map(
      (args) =>
        args[0] as {
          modelName: string;
          calledMethod: string;
          methodProperties: Record<string, unknown>;
        },
    );
    expect(requests[0]!.modelName).toBe('Counterparty');
    expect(requests[0]!.calledMethod).toBe('save');
    expect(requests[1]!.modelName).toBe('InternetDocument');
    expect(requests[1]!.methodProperties.Recipient).toBe('recipient-cp');
    expect(requests[1]!.methodProperties.ContactRecipient).toBe('recipient-contact');
  });

  it('throws rather than shipping when the recipient refs are missing', async () => {
    const client = fakeClient([[{ Ref: 'recipient-cp' }]]);
    await expect(createWaybill(client, INPUT)).rejects.toThrow(/recipient refs/);
  });
});

describe('waybillPrintUrl', () => {
  it('builds the two print URLs, key inside — proxy-only by construction', () => {
    expect(waybillPrintUrl('doc-ref', 'marking', 'KEY')).toBe(
      'https://my.novaposhta.ua/orders/printMarking100x100/orders[]/doc-ref/type/pdf/apiKey/KEY',
    );
    expect(waybillPrintUrl('doc-ref', 'document', 'KEY')).toBe(
      'https://my.novaposhta.ua/orders/printDocument/orders[]/doc-ref/type/pdf/apiKey/KEY',
    );
  });
});
