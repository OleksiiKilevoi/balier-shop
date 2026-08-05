import type { Kopiykas } from '~/lib/money';
import { UAH } from '~/lib/money';
import type { CreateInvoiceInput, Invoice, InvoiceStatus, PaymentPort } from '~/lib/ports';

/**
 * Monobank Acquiring adapter. https://api.monobank.ua/docs/acquiring.html
 *
 * `verifyWebhook`'s wire formats could not be confirmed against live
 * documentation while planning (the docs page is a JS-rendered SPA that
 * returned only navigation, no schema), so both are handled defensively:
 *
 *  - **public key** — `GET /pubkey` returns `key` as base64 of a PEM document,
 *    *not* of the DER bytes. Confirmed live 2026-08-04, after every real
 *    webhook had been silently 403ing; `normalizePublicKey` unwraps it.
 *  - **signature** — Monobank's own sample verification code (Java/PHP) reads
 *    an ASN.1 DER-encoded ECDSA signature, but Web Crypto's `ECDSA` verify only
 *    accepts raw IEEE-P1363 (r‖s), so `normalizeSignature` converts DER to raw
 *    and passes an already-raw 64-byte signature through. Still unconfirmed
 *    against a real captured webhook — see `docs/STATE.md`.
 */

const BASE_URL = 'https://api.monobank.ua/api/merchant/';
const CURVE = 'P-256';
const COMPONENT_LENGTH = 32; // bytes per r/s component for P-256

export function createMonobankPayment(token: string): PaymentPort {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, BASE_URL), {
      ...init,
      headers: { 'X-Token': token, 'content-type': 'application/json', ...init?.headers },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Monobank ${path} failed: ${response.status} ${body}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
      const body = {
        amount: input.amount,
        ccy: UAH,
        merchantPaymInfo: {
          reference: input.orderNumber,
          destination: `Замовлення ${input.orderNumber}`,
          basketOrder: input.items.map((item) => ({
            name: item.productTitle,
            qty: item.quantity,
            sum: item.unitPrice,
            unit: 'шт.',
            code: item.sku,
          })),
        },
        redirectUrl: input.redirectUrl,
        webHookUrl: input.webhookUrl,
        validity: input.validitySeconds,
      };

      return request<Invoice>('invoice/create', { method: 'POST', body: JSON.stringify(body) });
    },

    async getInvoiceStatus(invoiceId: string): Promise<{ status: InvoiceStatus; amount: Kopiykas }> {
      const result = await request<{ status: InvoiceStatus; amount: Kopiykas }>(
        `invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`,
      );
      return { status: result.status, amount: result.amount };
    },

    async removeInvoice(invoiceId: string): Promise<void> {
      // «Інвалідація рахунку»: kills the hosted payment page for an invoice
      // whose payment has not started. Monobank rejects it for a finished
      // invoice, which surfaces here as a throw — the port documents removal
      // as best-effort, so callers catch and log rather than unwind anything.
      await request<unknown>('invoice/remove', {
        method: 'POST',
        body: JSON.stringify({ invoiceId }),
      });
    },

    async verifyWebhook(rawBody: string, signature: string | null): Promise<boolean> {
      if (!signature) return false;

      try {
        const { key: pubkeyBase64 } = await request<{ key: string }>('pubkey');
        // TS types `new Uint8Array(n)` as `Uint8Array<ArrayBufferLike>`, which
        // `BufferSource` (needing `ArrayBuffer` specifically) rejects — a known
        // lib.dom.d.ts strictness bump, not a real runtime concern here.
        const publicKey = await crypto.subtle.importKey(
          'spki',
          normalizePublicKey(base64ToBytes(pubkeyBase64)) as BufferSource,
          { name: 'ECDSA', namedCurve: CURVE },
          false,
          ['verify'],
        );

        const rawSignature = normalizeSignature(base64ToBytes(signature));

        return await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          publicKey,
          rawSignature as BufferSource,
          new TextEncoder().encode(rawBody),
        );
      } catch {
        // A malformed key, signature or body is "not valid", not a crash.
        return false;
      }
    },
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * `GET /pubkey` returns `key` as base64 of a **PEM document**, not of the DER
 * bytes — confirmed live against the real API: the decoded payload starts with
 * `0x2d` (`-`), i.e. `-----BEGIN PUBLIC KEY-----`. Web Crypto's `importKey`
 * with format `spki` wants the DER, so unwrap the PEM armour and decode the
 * body. A payload that is already DER (`SEQUENCE`, `0x30`) passes through, the
 * same defensive shape `normalizeSignature` uses.
 */
function normalizePublicKey(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0x30) return bytes;

  const pem = new TextDecoder().decode(bytes);
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');

  if (!body) throw new Error('pubkey is neither DER nor PEM');
  return base64ToBytes(body);
}

/** Passes an already-raw r‖s signature through; converts a DER one. */
function normalizeSignature(bytes: Uint8Array): Uint8Array {
  if (bytes.length === COMPONENT_LENGTH * 2) return bytes;
  return derToRaw(bytes, COMPONENT_LENGTH);
}

/**
 * ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }` → fixed-width raw `r‖s`, the
 * format Web Crypto's ECDSA verify requires. Standard conversion for any
 * ECDSA signature produced by a library that emits DER (Java, OpenSSL, …).
 */
function derToRaw(der: Uint8Array, componentLength: number): Uint8Array {
  let offset = 0;

  const readLength = (): number => {
    let length = der[offset++]!;
    if (length & 0x80) {
      const byteCount = length & 0x7f;
      length = 0;
      for (let i = 0; i < byteCount; i++) length = (length << 8) | der[offset++]!;
    }
    return length;
  };

  if (der[offset++] !== 0x30) throw new Error('expected DER SEQUENCE');
  readLength();

  const readInteger = (): Uint8Array => {
    if (der[offset++] !== 0x02) throw new Error('expected DER INTEGER');
    const length = readLength();
    const bytes = der.slice(offset, offset + length);
    offset += length;
    return bytes;
  };

  const toFixedWidth = (component: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < component.length - 1 && component[start] === 0) start++;
    const trimmed = component.slice(start);
    if (trimmed.length > componentLength) throw new Error('DER integer wider than the curve order');
    const fixed = new Uint8Array(componentLength);
    fixed.set(trimmed, componentLength - trimmed.length);
    return fixed;
  };

  const r = toFixedWidth(readInteger());
  const s = toFixedWidth(readInteger());

  const raw = new Uint8Array(componentLength * 2);
  raw.set(r, 0);
  raw.set(s, componentLength);
  return raw;
}
