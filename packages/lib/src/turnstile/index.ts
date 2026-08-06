import type { CaptchaPort } from '../ports';

/**
 * Cloudflare Turnstile adapter. https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * `verify()` never throws — same contract as `NotifierPort.send()`: a
 * Turnstile outage must fail closed (the caller treats `false` as "reject
 * the request"), not crash the checkout route with an unhandled rejection.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResponse {
  success: boolean;
}

export function createTurnstileCaptcha(secretKey: string): CaptchaPort {
  return {
    async verify(token: string, remoteIp?: string): Promise<boolean> {
      if (!token) return false;

      const body = new URLSearchParams({ secret: secretKey, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);

      try {
        const response = await fetch(SITEVERIFY_URL, { method: 'POST', body });
        if (!response.ok) return false;

        const result = (await response.json()) as SiteverifyResponse;
        return result.success === true;
      } catch {
        return false;
      }
    },
  };
}
