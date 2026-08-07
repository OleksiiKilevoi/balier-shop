import { describe, expect, it } from 'vitest';
import { orderStatus } from '../db/schema';
import { registerEligible } from './register';

/**
 * The pure half of NP-5: which order may go onto a new register. The
 * transactional halves (`attachRegister` and friends) are `FOR UPDATE`
 * plumbing driven live, like the waybill's.
 */

describe('registerEligible', () => {
  it('accepts exactly a packed order with a panel-made waybill and no register', () => {
    expect(
      registerEligible({ status: 'packed', npTtnRef: 'doc-ref', npScanSheetRef: null }),
    ).toBe(true);
  });

  it('refuses every status but packed — a register is composed before the handover', () => {
    for (const status of orderStatus.enumValues) {
      if (status === 'packed') continue;
      expect(registerEligible({ status, npTtnRef: 'doc-ref', npScanSheetRef: null })).toBe(false);
    }
  });

  it('refuses a hand-entered waybill — the carrier call takes the document Ref it lacks', () => {
    expect(registerEligible({ status: 'packed', npTtnRef: null, npScanSheetRef: null })).toBe(
      false,
    );
  });

  it('refuses an order already on a register', () => {
    expect(
      registerEligible({ status: 'packed', npTtnRef: 'doc-ref', npScanSheetRef: 'sheet-ref' }),
    ).toBe(false);
  });
});
