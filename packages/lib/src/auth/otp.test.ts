import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  generateOtpCode,
  generateTelegramLinkCode,
  hashOtp,
  telegramWebhookSecret,
  verifyOtpHash,
} from './otp';

const SECRET = 'test-secret-at-least-32-bytes-long-for-realism';
const USER_ID = '6f3f0a52-5bb2-4e51-9c1c-0af0f0a1b2c3';

describe('generateOtpCode', () => {
  it('is always exactly six digits, zero-padded', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('does not hand out one constant code', () => {
    const draws = new Set(Array.from({ length: 50 }, () => generateOtpCode()));
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe('generateTelegramLinkCode', () => {
  it("stays inside Telegram's start-payload alphabet and under its length cap", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateTelegramLinkCode();
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(code.length).toBeLessThanOrEqual(64);
    }
  });

  it('never repeats — it is the whole proof of the handshake', () => {
    const draws = new Set(Array.from({ length: 100 }, () => generateTelegramLinkCode()));
    expect(draws.size).toBe(100);
  });
});

describe('hashOtp / verifyOtpHash', () => {
  it('verifies the code it hashed', async () => {
    const stored = await hashOtp(SECRET, USER_ID, '042731');
    await expect(verifyOtpHash(SECRET, USER_ID, '042731', stored)).resolves.toBe(true);
  });

  it('refuses a wrong code', async () => {
    const stored = await hashOtp(SECRET, USER_ID, '042731');
    await expect(verifyOtpHash(SECRET, USER_ID, '042732', stored)).resolves.toBe(false);
  });

  it('binds the hash to the user: the same six digits on another row prove nothing', async () => {
    const stored = await hashOtp(SECRET, USER_ID, '042731');
    await expect(verifyOtpHash(SECRET, 'another-user-id', '042731', stored)).resolves.toBe(false);
  });

  it('is keyed: without the secret the same inputs hash differently', async () => {
    const a = await hashOtp(SECRET, USER_ID, '042731');
    const b = await hashOtp('other-secret', USER_ID, '042731');
    expect(a).not.toBe(b);
  });
});

describe('telegramWebhookSecret', () => {
  it('derives the same value from the same token — the Worker and the script must agree', async () => {
    const a = await telegramWebhookSecret('12345:AA-bot-token');
    const b = await telegramWebhookSecret('12345:AA-bot-token');
    expect(a).toBe(b);
  });

  it('differs per bot token', async () => {
    const a = await telegramWebhookSecret('12345:AA-bot-token');
    const b = await telegramWebhookSecret('67890:BB-bot-token');
    expect(a).not.toBe(b);
  });

  it("fits Telegram's secret_token rules: 1–256 chars of A-Za-z0-9_-", async () => {
    const secret = await telegramWebhookSecret('12345:AA-bot-token');
    expect(secret).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  });
});

describe('constantTimeEqual', () => {
  it('agrees with === on equality', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
