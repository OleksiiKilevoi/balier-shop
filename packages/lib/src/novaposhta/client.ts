/**
 * Nova Poshta's entire API is one endpoint; the method name and its
 * parameters travel in the body. https://developers.novaposhta.ua/
 *
 * Errors arrive with HTTP 200 and `success: false` — this is the one place
 * that check has to happen, so every caller gets it by construction rather
 * than by remembering to look.
 */

const ENDPOINT = 'https://api.novaposhta.ua/v2.0/json/';

export interface NovaPoshtaRequest {
  modelName: string;
  calledMethod: string;
  /**
   * Values are `unknown` rather than `string` because the document methods
   * (`InternetDocument.save`, `ScanSheet.insertDocuments`, tracking) take
   * nested arrays — `OptionsSeat`, `BackwardDeliveryData`, `Documents` — while
   * the reference lookups are flat string maps. The API itself is stringly
   * typed either way; each caller owns its payload's shape.
   */
  methodProperties?: Record<string, unknown>;
}

interface NovaPoshtaResponse<T> {
  success: boolean;
  data: T[];
  /**
   * Usually an array of sentences — but the document methods answer a refused
   * `delete` with an *object* keyed by ref (seen live 2026-08-07:
   * `{"019fdbbd-…": "Document already deleted 20451505720271"}`), and the
   * first version of this client crashed on `.join` right there, eating the
   * actual error. Hence `formatErrors` below.
   */
  errors: string[] | Record<string, string>;
}

function formatErrors(errors: NovaPoshtaResponse<unknown>['errors']): string {
  const parts = Array.isArray(errors) ? errors : Object.values(errors ?? {});
  return parts.length > 0 ? parts.join('; ') : 'no error text';
}

export function createNovaPoshtaClient(apiKey: string) {
  return {
    async call<T>(request: NovaPoshtaRequest): Promise<T[]> {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey, ...request }),
      });

      if (!response.ok) {
        throw new Error(`Nova Poshta ${request.calledMethod} failed: HTTP ${response.status}`);
      }

      const body = (await response.json()) as NovaPoshtaResponse<T>;

      if (!body.success) {
        throw new Error(`Nova Poshta ${request.calledMethod} failed: ${formatErrors(body.errors)}`);
      }

      return body.data;
    },
  };
}

export type NovaPoshtaClient = ReturnType<typeof createNovaPoshtaClient>;
