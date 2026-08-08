import { and, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { adminUsers } from '../schema';
import { normalizeEmail } from '../../auth/password';
import { OTP_MAX_ATTEMPTS } from '../../auth/otp';
import { uniqueConstraint } from './unique';

/**
 * The Telegram sign-in's reads and writes: the deep-link handshake
 * (`/settings` mints a code, `/telegram/webhook` consumes it) and the one-time
 * codes `/login/telegram` sends and checks.
 *
 * Same house rule as `./adminUsers`: anything an account's state forbids is
 * enforced *in the `WHERE`*, not by a check the caller might forget — an
 * expired link does not bind, a disabled account cannot claim an attempt, and
 * five attempts mean five even when the guesses arrive in parallel.
 */

/**
 * A fresh handshake link for the signed-in user, replacing any pending one —
 * an account holds one invitation, not a collection, so «Створити нове
 * посилання» quietly invalidates the old.
 */
export async function setTelegramLinkCode(
  db: Db,
  userId: string,
  code: string,
  expiresAt: Date,
): Promise<void> {
  await db
    .update(adminUsers)
    .set({ telegramLinkCode: code, telegramLinkExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(adminUsers.id, userId));
}

/**
 * Cuts the chat loose — and the pending link and any live code with it. A code
 * already sent to a chat being unlinked must not stay able to sign in.
 */
export async function unlinkTelegram(db: Db, userId: string): Promise<void> {
  await db
    .update(adminUsers)
    .set({
      telegramChatId: null,
      telegramLinkCode: null,
      telegramLinkExpiresAt: null,
      otpHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      updatedAt: new Date(),
    })
    .where(eq(adminUsers.id, userId));
}

export type TelegramLinkResult =
  | { ok: true; email: string }
  /**
   * `code_invalid` — unknown, expired, or the account behind it may no longer
   * sign in; the webhook's reply words them identically on purpose.
   * `chat_taken` — this chat already answers for another account, refused
   * because a chat that answers codes for two accounts collapses them into one.
   */
  | { ok: false; reason: 'code_invalid' | 'chat_taken' };

/**
 * The webhook's half of the handshake: `/start <code>` arrives, the account
 * that minted the code gets the chat bound to it, the code is spent. One
 * statement, so a code cannot bind twice — the second `/start` finds it
 * already NULL and reads as invalid.
 */
export async function linkTelegramByCode(
  db: Db,
  code: string,
  chatId: string,
): Promise<TelegramLinkResult> {
  try {
    const updated = await db
      .update(adminUsers)
      .set({
        telegramChatId: chatId,
        telegramLinkCode: null,
        telegramLinkExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(adminUsers.telegramLinkCode, code),
          gt(adminUsers.telegramLinkExpiresAt, new Date()),
          // The link was minted from a live session, but the account may have
          // been switched off or archived since — a dead account must not
          // finish a handshake either.
          eq(adminUsers.isActive, true),
          isNull(adminUsers.archivedAt),
        ),
      )
      .returning({ email: adminUsers.email });

    const row = updated[0];
    if (!row) return { ok: false, reason: 'code_invalid' };
    return { ok: true, email: row.email };
  } catch (error) {
    if (uniqueConstraint(error)?.includes('telegram_chat_id')) {
      return { ok: false, reason: 'chat_taken' };
    }
    throw error;
  }
}

/* -------------------------------------------------------------- the sign-in */

export interface OtpAccount {
  id: string;
  email: string;
  /** NULL means the account never linked Telegram — no code can be sent. */
  telegramChatId: string | null;
  /** Of the *current* code; `expiresAt − OTP_TTL_SECONDS` is when it was sent. */
  otpExpiresAt: Date | null;
}

/**
 * The row `/login/telegram` works against. Live accounts only, filtered here
 * for the reason `findActiveAdminByEmail` documents: an account taken away
 * must be indistinguishable from one that never existed.
 */
export async function findOtpAccountByEmail(db: Db, email: string): Promise<OtpAccount | null> {
  const [row] = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      telegramChatId: adminUsers.telegramChatId,
      otpExpiresAt: adminUsers.otpExpiresAt,
    })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.email, normalizeEmail(email)),
        eq(adminUsers.isActive, true),
        isNull(adminUsers.archivedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** A fresh code replaces the old one and its spent attempts with it. */
export async function issueOtp(
  db: Db,
  userId: string,
  otpHash: string,
  expiresAt: Date,
): Promise<void> {
  await db
    .update(adminUsers)
    .set({ otpHash, otpExpiresAt: expiresAt, otpAttempts: 0 })
    .where(eq(adminUsers.id, userId));
}

/**
 * One guess, granted or refused. The increment and the read are a single
 * `UPDATE … RETURNING`, which is the whole security property: check-in-JS,
 * write-after would let parallel guesses share one attempt, and this way the
 * fifth grant is the last whatever the timing. Returns the stored hash to
 * check the guess against, or `null` when there is nothing live to guess at —
 * no code, expired, or attempts spent.
 */
export async function claimOtpAttempt(db: Db, userId: string): Promise<string | null> {
  const updated = await db
    .update(adminUsers)
    .set({ otpAttempts: sql`${adminUsers.otpAttempts} + 1` })
    .where(
      and(
        eq(adminUsers.id, userId),
        isNotNull(adminUsers.otpHash),
        gt(adminUsers.otpExpiresAt, new Date()),
        lt(adminUsers.otpAttempts, OTP_MAX_ATTEMPTS),
      ),
    )
    .returning({ otpHash: adminUsers.otpHash });

  return updated[0]?.otpHash ?? null;
}

/** A code is one use: spent on success, in the same moment the session is minted. */
export async function clearOtp(db: Db, userId: string): Promise<void> {
  await db
    .update(adminUsers)
    .set({ otpHash: null, otpExpiresAt: null, otpAttempts: 0 })
    .where(eq(adminUsers.id, userId));
}
