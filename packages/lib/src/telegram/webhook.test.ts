import { describe, expect, it } from 'vitest';
import { parseTelegramStart } from './webhook';

/** A real update, trimmed to what the parser reads. */
function update(overrides: { chatType?: string; chatId?: unknown; text?: unknown } = {}): unknown {
  return {
    update_id: 700000001,
    message: {
      message_id: 42,
      chat: { id: overrides.chatId ?? 1234567890, type: overrides.chatType ?? 'private' },
      text: overrides.text ?? '/start abc_DEF-123',
    },
  };
}

describe('parseTelegramStart', () => {
  it('reads /start with a payload from a private chat', () => {
    expect(parseTelegramStart(update())).toEqual({
      chatId: '1234567890',
      payload: 'abc_DEF-123',
    });
  });

  it('stringifies the chat id without going through parseInt — ids overflow 32 bits', () => {
    expect(parseTelegramStart(update({ chatId: 9007199254740 }))).toEqual({
      chatId: '9007199254740',
      payload: 'abc_DEF-123',
    });
    expect(parseTelegramStart(update({ chatId: '1234567890' }))?.chatId).toBe('1234567890');
  });

  it('drops a bare /start — no payload means no handshake to finish', () => {
    expect(parseTelegramStart(update({ text: '/start' }))).toBeNull();
    expect(parseTelegramStart(update({ text: '/start   ' }))).toBeNull();
  });

  it('drops group chats, including the managers’ chat the bot notifies', () => {
    expect(parseTelegramStart(update({ chatType: 'group' }))).toBeNull();
    expect(parseTelegramStart(update({ chatType: 'supergroup' }))).toBeNull();
  });

  it('drops ordinary messages and commands that are not /start', () => {
    expect(parseTelegramStart(update({ text: 'привіт' }))).toBeNull();
    expect(parseTelegramStart(update({ text: '/help' }))).toBeNull();
    expect(parseTelegramStart(update({ text: '/started abc' }))).toBeNull();
  });

  it('drops a payload outside the deep-link alphabet', () => {
    expect(parseTelegramStart(update({ text: '/start код' }))).toBeNull();
    expect(parseTelegramStart(update({ text: `/start ${'a'.repeat(65)}` }))).toBeNull();
  });

  it('survives shapes that are not updates at all', () => {
    expect(parseTelegramStart(null)).toBeNull();
    expect(parseTelegramStart('text')).toBeNull();
    expect(parseTelegramStart({})).toBeNull();
    expect(parseTelegramStart({ message: {} })).toBeNull();
    expect(parseTelegramStart({ message: { chat: {}, text: 42 } })).toBeNull();
  });
});
