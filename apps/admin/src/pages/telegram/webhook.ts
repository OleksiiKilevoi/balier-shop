import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { constantTimeEqual, telegramWebhookSecret } from '@balier/lib/auth';
import { createDb } from '@balier/lib/db';
import { linkTelegramByCode } from '@balier/lib/db/queries/adminTelegram';
import {
  TELEGRAM_CHAT_TAKEN_TEXT,
  TELEGRAM_LINK_INVALID_TEXT,
  telegramLinkedText,
} from '@balier/lib/i18n/admin';
import { sendTelegramMessage } from '@balier/lib/notify/telegram';
import { parseTelegramStart } from '@balier/lib/telegram/webhook';

/**
 * Where the bot's updates land — registered once per environment by
 * `pnpm tg:webhook set` (`scripts/telegram-webhook.ts`). One job: finish the
 * account-linking handshake. An operator asks `/settings` for a deep link,
 * opens `t.me/<bot>?start=<code>`, Telegram delivers that tap here as
 * `/start <code>`, and the account that minted the code gets this private
 * chat bound as its login-code destination.
 *
 * The route is on the gate's allowlist (`src/middleware.ts`) because Telegram
 * cannot hold a session — its POSTs authenticate differently: every delivery
 * carries the `secret_token` the registration handed Telegram, derived from
 * the bot token (`telegramWebhookSecret`), and anything without it is turned
 * away before the body is read.
 *
 * Everything authenticated but unusable — chatter, group messages, commands
 * that are not a handshake — is answered `200` and dropped: any other status
 * makes Telegram redeliver the same update for days. `parseTelegramStart` is
 * the sieve.
 */
export const prerender = false;

const ok = () => new Response(null, { status: 200 });

export const POST: APIRoute = async ({ request, locals }) => {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  // No token means no webhook could have been registered — whatever this POST
  // is, it is not Telegram. Same for a wrong or missing secret header.
  if (!botToken) return new Response(null, { status: 503 });

  const given = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!constantTimeEqual(given, await telegramWebhookSecret(botToken))) {
    return new Response(null, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    // Authenticated but not JSON. Telegram does not send these; acknowledge
    // rather than invite a redelivery of something unreadable.
    return ok();
  }

  const start = parseTelegramStart(update);
  if (!start) return ok();

  // A thrown query (Neon unreachable) deliberately escapes to a 500 here:
  // this is the one shape of update worth Telegram's retry, and the code
  // stays unspent until a retry finds the database back.
  const result = await linkTelegramByCode(createDb(env.DATABASE_URL), start.payload, start.chatId);

  const reply = result.ok
    ? telegramLinkedText(result.email)
    : result.reason === 'chat_taken'
      ? TELEGRAM_CHAT_TAKEN_TEXT
      : TELEGRAM_LINK_INVALID_TEXT;

  // The person is looking at the chat they just pressed Start in — answer
  // there. Best-effort and off the response path: the link is already made
  // (or refused), and a failed pleasantry must not make Telegram redeliver
  // the handshake.
  locals.cfContext?.waitUntil?.(sendTelegramMessage(botToken, start.chatId, reply));

  return ok();
};
