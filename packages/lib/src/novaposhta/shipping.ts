import type { WaybillOps } from '../ports';
import { createNovaPoshtaClient } from './client';
import { createScanSheet, deleteScanSheet, removeFromScanSheet, scanSheetPrintUrl } from './scanSheet';
import { trackWaybills } from './tracking';
import { createWaybill, deleteWaybill, waybillPrintUrl } from './waybill';

/**
 * The Nova Poshta adapter for waybill operations — the `WaybillOps` slice of
 * `ShippingPort`. The admin Worker and the cron construct this once per
 * request from their own `NOVAPOSHTA_API_KEY` and hand it to domain code, so
 * that domain code never sees the key — which matters doubly here, because the
 * print URLs *contain* it and must stay behind the proxy route.
 */
export function createNovaPoshtaShipping(apiKey: string): WaybillOps {
  const client = createNovaPoshtaClient(apiKey);

  return {
    createWaybill: (input) => createWaybill(client, input),
    deleteWaybill: (documentRef) => deleteWaybill(client, documentRef),
    trackWaybills: (numbers) => trackWaybills(client, numbers),
    waybillPrintUrl: (documentRef, kind) => waybillPrintUrl(documentRef, kind, apiKey),
    createScanSheet: (documentRefs) => createScanSheet(client, documentRefs),
    removeFromScanSheet: (scanSheetRef, documentRefs) =>
      removeFromScanSheet(client, scanSheetRef, documentRefs),
    deleteScanSheet: (scanSheetRef) => deleteScanSheet(client, scanSheetRef),
    scanSheetPrintUrl: (scanSheetRef) => scanSheetPrintUrl(scanSheetRef, apiKey),
  };
}
