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
  methodProperties?: Record<string, string>;
}

interface NovaPoshtaResponse<T> {
  success: boolean;
  data: T[];
  errors: string[];
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
        throw new Error(`Nova Poshta ${request.calledMethod} failed: ${body.errors.join('; ')}`);
      }

      return body.data;
    },
  };
}

export type NovaPoshtaClient = ReturnType<typeof createNovaPoshtaClient>;
