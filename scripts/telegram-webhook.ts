import { config as loadEnv } from 'dotenv';
import { telegramWebhookSecret } from '@balier/lib/auth/otp';

/**
 * Register (or inspect, or remove) the bot's webhook — the once-per-environment
 * step that makes the `/settings` → Telegram account-linking handshake work.
 *
 *   pnpm tg:webhook set [url]   # default: the deployed admin Worker
 *   pnpm tg:webhook info
 *   pnpm tg:webhook delete
 *
 * Telegram allows one webhook per bot, so `set` points the *whole bot* at one
 * environment — the deployed panel, normally. `pnpm dev:admin` therefore never
 * receives updates, and linking is tested against the deployed Worker; that is
 * a known trade, not an oversight.
 *
 * The `secret_token` handed to Telegram here is derived from the bot token
 * (`telegramWebhookSecret`) — the same derivation the webhook route performs —
 * so the two cannot drift and there is no extra secret to provision.
 */

// The token lives in the admin Worker's env file, not the root one.
loadEnv({ path: 'apps/admin/.dev.vars', quiet: true });
loadEnv({ path: '.dev.vars', quiet: true });
loadEnv({ quiet: true });

const DEFAULT_URL = 'https://admin.balier.mlosko.dev/telegram/webhook';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set — put it in apps/admin/.dev.vars.');
  process.exit(1);
}

async function call(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  const answer = (await response.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!answer.ok) {
    console.error(`${method} refused: ${answer.description ?? 'no description'}`);
    process.exit(1);
  }
  return answer.result;
}

const [command, urlArg] = process.argv.slice(2);

switch (command) {
  case 'set': {
    const url = urlArg ?? DEFAULT_URL;
    if (!url.startsWith('https://')) {
      console.error('The webhook URL must be https.');
      process.exit(1);
    }

    await call('setWebhook', {
      url,
      secret_token: await telegramWebhookSecret(token),
      // The handshake only ever arrives as a message; subscribing to nothing
      // else keeps every other update type from being delivered at all.
      allowed_updates: ['message'],
    });
    console.log(`Webhook set to ${url}`);
    break;
  }

  case 'info': {
    console.log(JSON.stringify(await call('getWebhookInfo'), null, 2));
    break;
  }

  case 'delete': {
    await call('deleteWebhook');
    console.log('Webhook deleted.');
    break;
  }

  default: {
    console.error('Usage: pnpm tg:webhook <set [url] | info | delete>');
    process.exit(1);
  }
}
