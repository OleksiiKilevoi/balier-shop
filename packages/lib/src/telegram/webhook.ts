/**
 * Reading a Telegram Bot API update, for the admin panel's account-linking
 * webhook (`apps/admin/src/pages/telegram/webhook.ts`).
 *
 * The bot hears more than the handshake: it sits in the managers' group chat
 * for order notifications, and anyone in the world can open a private chat
 * with it and type. So this parser is deliberately a sieve — the one shape it
 * returns is `/start <payload>` in a **private** chat, and everything else,
 * including a bare `/start`, comes back `null` for the route to acknowledge
 * and drop. An update is attacker-supplied JSON until proven otherwise, hence
 * the field-by-field checks rather than a cast.
 */

export interface TelegramStart {
  /** `message.chat.id`, stringified — chat ids overflow 32 bits, never `parseInt` them. */
  chatId: string;
  /** The deep link's `start=` payload, verbatim. */
  payload: string;
}

/**
 * `t.me/<bot>?start=<payload>` arrives as the message text `/start <payload>`.
 * Telegram caps the payload at 64 chars of `A-Za-z0-9_-`; enforcing the same
 * alphabet here means whatever reaches the database lookup is at worst a wrong
 * code, never a surprise.
 */
const START_PATTERN = /^\/start[ ]+([A-Za-z0-9_-]{1,64})$/;

export function parseTelegramStart(update: unknown): TelegramStart | null {
  if (typeof update !== 'object' || update === null) return null;

  const message = (update as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null) return null;

  const { chat, text } = message as Record<string, unknown>;
  if (typeof chat !== 'object' || chat === null) return null;
  if (typeof text !== 'string') return null;

  const { id, type } = chat as Record<string, unknown>;
  // Group chats are out: a handshake finished there would point login codes at
  // a room, and the managers' chat is exactly such a room.
  if (type !== 'private') return null;
  if (typeof id !== 'number' && typeof id !== 'string') return null;

  const match = START_PATTERN.exec(text.trim());
  if (!match) return null;

  return { chatId: String(id), payload: match[1]! };
}
