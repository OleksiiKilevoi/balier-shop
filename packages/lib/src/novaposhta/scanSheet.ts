import type { ScanSheetInfo } from '../ports';
import type { NovaPoshtaClient } from './client';

/**
 * The register of shipments (реєстр відправлень / ScanSheet) — the one piece
 * of paper for a whole batch of parcels, so the branch scans one barcode
 * instead of accepting each parcel separately. This is what the original
 * «створення накладних» request actually meant (docs/plans/novaposhta.md).
 *
 * Response shapes here are the least-documented corner of API 2.0 — each call
 * notes what it expects and NP-5's live driving is what confirms them.
 */

interface RawScanSheetInsert {
  Ref?: string;
  Number?: string;
  /* insertDocuments reports per-document successes/errors alongside the sheet
     itself; a sheet with zero accepted documents still comes back `success:
     true`, which is why the guard below checks the refs rather than trusting
     the envelope. */
}

/**
 * Creates a register from waybill document refs. NP also supports adding to an
 * existing sheet via `Ref`, deliberately not exposed: the panel's model is one
 * register per handover batch, made when the batch is ready.
 */
export async function createScanSheet(
  client: NovaPoshtaClient,
  documentRefs: readonly string[],
): Promise<ScanSheetInfo> {
  const [row] = await client.call<RawScanSheetInsert>({
    modelName: 'ScanSheet',
    calledMethod: 'insertDocuments',
    methodProperties: { DocumentRefs: [...documentRefs] },
  });

  if (!row?.Ref || !row.Number) {
    throw new Error('Nova Poshta ScanSheet.insertDocuments returned no register');
  }
  return { ref: row.Ref, number: row.Number };
}

/** Takes single waybills off a register; the register itself survives. */
export async function removeFromScanSheet(
  client: NovaPoshtaClient,
  scanSheetRef: string,
  documentRefs: readonly string[],
): Promise<void> {
  await client.call({
    modelName: 'ScanSheet',
    calledMethod: 'removeDocuments',
    methodProperties: { Ref: scanSheetRef, DocumentRefs: [...documentRefs] },
  });
}

/** Deletes the register; the waybills on it are untouched and merely unlisted. */
export async function deleteScanSheet(
  client: NovaPoshtaClient,
  scanSheetRef: string,
): Promise<void> {
  await client.call({
    modelName: 'ScanSheet',
    calledMethod: 'deleteScanSheet',
    methodProperties: { ScanSheetRefs: [scanSheetRef] },
  });
}

/** Same key-in-the-URL warning as `waybillPrintUrl` — proxy only, never a page. */
export function scanSheetPrintUrl(scanSheetRef: string, apiKey: string): string {
  return `https://my.novaposhta.ua/scanSheet/printScanSheet/refs[]/${scanSheetRef}/type/pdf/apiKey/${apiKey}`;
}
