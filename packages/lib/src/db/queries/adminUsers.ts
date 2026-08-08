import { and, asc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Db, TxDb } from '../index';
import { adminUsers } from '../schema';
import type { AdminRole } from '../schema';
import { normalizeEmail } from '../../auth/password';
import { uniqueConstraint } from './unique';

/**
 * The login form's reads and writes, and everything `/users` does.
 *
 * **No helper here returns a password hash for a row that is not the caller's
 * own.** `findActiveAdminByEmail` is the login check and `findAdminById` is the
 * "prove you know your current password" check; the list a screen renders is
 * `listAdminUsers`, which cannot return a hash at all. That is deliberate: a
 * list with hashes in it only has to leak once, and there is no screen that
 * would have a use for one.
 */

export interface AdminUserRecord {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  passwordHash: string;
  /** Tokens minted before this are refused — see `~/auth/session`. */
  sessionsValidFrom: Date;
  /**
   * Always `true` here: both readers below return `null` for a disabled row, so
   * an `AdminUserRecord` is by construction an account that may sign in.
   *
   * Carried anyway, so `sessionStillValid` can take the whole record and decide
   * on both rules itself. A total check that reads `user.isActive` cannot be
   * defeated by a future reader that forgets the filter; one that trusts the
   * filter silently can.
   */
  isActive: boolean;
  /** Always `null` here, and carried for the same reason as `isActive`. */
  archivedAt: Date | null;
  /**
   * The Telegram sign-in's account state, carried so `/settings` can render
   * the «Вхід через Telegram» section from the row the gate already read.
   * The *transient* half — the current code and its attempts — deliberately
   * is not here; that lives in `./adminTelegram`, read only where it is used.
   */
  telegramChatId: string | null;
  telegramLinkCode: string | null;
  telegramLinkExpiresAt: Date | null;
}

/** The columns both login readers return. Written once so they cannot drift. */
const recordColumns = {
  id: adminUsers.id,
  email: adminUsers.email,
  name: adminUsers.name,
  role: adminUsers.role,
  passwordHash: adminUsers.passwordHash,
  sessionsValidFrom: adminUsers.sessionsValidFrom,
  isActive: adminUsers.isActive,
  archivedAt: adminUsers.archivedAt,
  telegramChatId: adminUsers.telegramChatId,
  telegramLinkCode: adminUsers.telegramLinkCode,
  telegramLinkExpiresAt: adminUsers.telegramLinkExpiresAt,
} as const;

/**
 * The one rule both readers apply after fetching: a row that may not sign in
 * comes back as no row at all. Disabled and archived are separate facts — an
 * archived account keeps whatever `isActive` it had, so this cannot be folded
 * into a single flag.
 */
function liveAccount(row: AdminUserRecord | undefined): AdminUserRecord | null {
  if (!row || !row.isActive || row.archivedAt !== null) return null;
  return row;
}

/**
 * The row a login attempt is checked against. **Disabled and archived users are
 * not returned** — taking an account away has to be indistinguishable from
 * never having had one, and doing that filtering here means no call site can
 * forget.
 */
export async function findActiveAdminByEmail(
  db: Db,
  email: string,
): Promise<AdminUserRecord | null> {
  const [row] = await db
    .select(recordColumns)
    .from(adminUsers)
    .where(eq(adminUsers.email, normalizeEmail(email)))
    .limit(1);

  return liveAccount(row);
}

/**
 * The signed-in user's own row, by the id in their session cookie. **This is
 * the gate's read** — `src/middleware.ts` calls it on every request the panel
 * serves, and hands the result to the page in `locals` so nothing reads it
 * twice.
 *
 * Four things depend on it being live rather than carried in the token, which
 * is signed but cannot be withdrawn: `isActive` (the account is not paused),
 * `archivedAt` (it has not been removed), `sessionsValidFrom` (the token has
 * not been revoked — `sessionStillValid`), and `role` (a demotion takes effect
 * on the next request, not at the end of the day).
 *
 * Anything that may not sign in comes back `null`, exactly as at login: one
 * filter, no call site able to forget it.
 */
export async function findActiveAdminById(db: Db, id: string): Promise<AdminUserRecord | null> {
  const [row] = await db
    .select(recordColumns)
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);

  return liveAccount(row);
}

/** Stamped after a successful login. Best-effort: never block a sign-in on it. */
export async function recordAdminLogin(db: Db, id: string): Promise<void> {
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, id));
}

/**
 * Replace a stored hash with one at the current cost. Called only from a
 * successful login, which is the one moment the plaintext exists to re-derive
 * from — see `needsRehash` in `~/lib/auth/password`.
 *
 * **Deliberately does not touch `sessionsValidFrom`.** A rehash is the same
 * password at a higher iteration count, done silently on somebody's behalf, and
 * signing every device out over it would be a punishment for our own upgrade.
 * A password *change* is a different act and calls `revokeAdminSessions` too.
 */
export async function updateAdminPasswordHash(
  db: Db,
  id: string,
  passwordHash: string,
): Promise<void> {
  await db
    .update(adminUsers)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(adminUsers.id, id));
}

/**
 * End every session this account holds, everywhere, now.
 *
 * One column, no session table to sweep: the gate compares the token's `iat`
 * against this instant and refuses anything older (`sessionStillValid`). It is
 * what makes «I think my password leaked» actionable — before this existed the
 * honest answer was «nothing can be done for twelve hours», and rotating
 * `ADMIN_SESSION_SECRET` to sign *everybody* out was the only lever.
 *
 * Called on a password change and on an admin resetting somebody else's
 * password. `updateAdminUser` does the same inline whenever an account is
 * switched off *or* back on. Not on a role change.
 */
export async function revokeAdminSessions(db: Db, id: string): Promise<void> {
  await db
    .update(adminUsers)
    .set({ sessionsValidFrom: new Date(), updatedAt: new Date() })
    .where(eq(adminUsers.id, id));
}

/* ---------------------------------------------------------- the users screen */

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  isActive: boolean;
  archivedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/**
 * Every account, for the admin-only `/users`. Both tabs come out of this one
 * query rather than one per tab: the panel has a handful of accounts, and the
 * counts on the tabs need the other side's rows anyway — two queries would buy
 * nothing and could disagree with each other.
 *
 * Disabled rows are included for the same reason they always were: hiding them
 * would leave no way to switch one back on, and «this address is already taken»
 * with nothing on screen using it is a mystery, not an answer. Archived rows
 * are here too and the screen files them under «Архів».
 *
 * No `passwordHash` in the selection, and that is the point (see the header).
 */
export async function listAdminUsers(db: Db): Promise<AdminUserRow[]> {
  return db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
      archivedAt: adminUsers.archivedAt,
      lastLoginAt: adminUsers.lastLoginAt,
      createdAt: adminUsers.createdAt,
    })
    .from(adminUsers)
    .orderBy(asc(adminUsers.createdAt));
}

/**
 * `email_taken` is a real answer a form shows, not a failure: two people are
 * one typo away from trying to add the same colleague. `last_admin` is the
 * guard below.
 */
export type AdminUserResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'email_taken' | 'last_admin' | 'not_found' | 'not_archived' | 'confirm_email';
    };

export interface NewAdminUser {
  email: string;
  name: string | null;
  role: AdminRole;
  passwordHash: string;
}

/**
 * Uniqueness is left to the constraint rather than to a `SELECT` first: the
 * check-then-insert version still races two admins adding the same address, and
 * the column is `unique` precisely so it does not have to be asked twice. Same
 * reasoning as the catalog's slugs — see `./unique`.
 */
export async function createAdminUser(db: Db, user: NewAdminUser): Promise<AdminUserResult> {
  try {
    await db.insert(adminUsers).values({
      email: normalizeEmail(user.email),
      name: user.name,
      role: user.role,
      passwordHash: user.passwordHash,
    });
    return { ok: true };
  } catch (error) {
    if (uniqueConstraint(error)?.includes('email')) return { ok: false, reason: 'email_taken' };
    throw error;
  }
}

/**
 * Role and active flag together, because they fail the same way: either one can
 * be the change that leaves the shop with nobody able to create an account
 * again, and the only way out of that is `pnpm admin:user` on somebody's laptop.
 *
 * "Am I about to remove the last admin" is asked as **are there other active
 * admins**, not as a count of all of them: a row that is active but a manager,
 * or an admin who is switched off, is not somebody who can sign in and fix
 * this. The count and the write are one transaction, because a check is
 * meaningless if the rows it is about can change between reading and writing.
 *
 * **Today the panel cannot reach this refusal, and that is worth saying rather
 * than leaving as a guard somebody assumes is doing work.** `/users` renders no
 * role or active control for your own row and refuses the POST anyway, so
 * self-demotion and self-disabling cannot happen — whoever is making the change is
 * themselves an active admin and is therefore always one of the "others" —
 * driven through the real screen, the count is never zero. What it covers is
 * everything that is not that screen: this function called from somewhere new,
 * and the day self-demotion becomes allowed. It costs one query on an action
 * performed a handful of times a year.
 */
export async function updateAdminUser(
  txDb: TxDb,
  id: string,
  fields: { role: AdminRole; isActive: boolean },
): Promise<AdminUserResult> {
  return txDb.transaction(async (tx) => {
    const [current] = await tx
      .select({ role: adminUsers.role, isActive: adminUsers.isActive })
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .limit(1);

    if (!current) return { ok: false, reason: 'not_found' };

    const wasLiveAdmin = current.role === 'admin' && current.isActive;
    const staysLiveAdmin = fields.role === 'admin' && fields.isActive;

    if (wasLiveAdmin && !staysLiveAdmin) {
      const [others] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(adminUsers)
        .where(
          and(
            ne(adminUsers.id, id),
            eq(adminUsers.role, 'admin'),
            eq(adminUsers.isActive, true),
            // An archived admin cannot sign in and fix anything, so it is not
            // one of the "others" this count is asking about.
            isNull(adminUsers.archivedAt),
          ),
        );

      if ((others?.count ?? 0) === 0) return { ok: false, reason: 'last_admin' };
    }

    /*
     * Any change to the active flag ends the account's sessions — **both
     * directions**, which is not the obvious half of it.
     *
     * Switching off is obvious: the gate's `isActive` check already turns those
     * requests away, and the stamp makes it stick. Switching back **on** is the
     * one that was found by driving it. Turning an account off and on again
     * inside twelve hours would otherwise hand the old browser its access back
     * — the gate stops refusing the moment `isActive` is true again, and the
     * token it was refusing is still in that browser. Stamping on the way in
     * costs nothing, because an account that was off has no live session to
     * end: every token it holds is one the gate was already refusing.
     *
     * (It also closes a one-second seam. `iat` is whole seconds, so a token
     * minted in the same second as a revocation deliberately survives — see
     * `sessionStillValid`, where that rule keeps a fresh sign-in from being
     * killed by the change that prompted it. Disable and re-enable in that same
     * second and the stamp alone would not have moved the token out of range.
     * That is exactly the case the test below reproduced.)
     *
     * A role change is not a reason to sign anybody out, and does not stamp.
     */
    const activeChanged = current.isActive !== fields.isActive;

    await tx
      .update(adminUsers)
      .set({
        role: fields.role,
        isActive: fields.isActive,
        updatedAt: new Date(),
        ...(activeChanged ? { sessionsValidFrom: new Date() } : {}),
      })
      .where(eq(adminUsers.id, id));

    return { ok: true };
  });
}

/**
 * An admin setting somebody else's password — the panel's answer to «I'm locked
 * out», which until now was a terminal and `pnpm admin:user password`.
 *
 * Worth being clear about what this is: it lets an admin take over another
 * account, since they choose the password and can then sign in as that person.
 * That is inherent to a reset an admin can perform without the old password,
 * and the reason the ability stops at `admin` rather than being part of the
 * panel's day job.
 *
 * It **does** end that account's sessions, in the same statement: this is the
 * action taken when somebody is locked out or their password is believed
 * compromised, and leaving the compromised browser signed in would defeat the
 * point of resetting it.
 *
 * Separate from `updateAdminPasswordHash` in two ways, then: that one is a
 * silent rehash and must not revoke anything, and this one reports a row that
 * is not there — it is aimed at an id from a form, which may name an account a
 * second tab has since removed from view.
 */
export async function setAdminUserPassword(
  db: Db,
  id: string,
  passwordHash: string,
): Promise<AdminUserResult> {
  const now = new Date();
  const updated = await db
    .update(adminUsers)
    .set({ passwordHash, sessionsValidFrom: now, updatedAt: now })
    .where(eq(adminUsers.id, id))
    .returning({ id: adminUsers.id });

  return updated.length > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
}

/* ------------------------------------------------------- removing an account */

/**
 * «Видалити» — the account leaves the panel's list for the «Архів» tab.
 *
 * Not a `DELETE`, and the two-step arrangement is the point: this one is
 * reversible, and the row's `lastLoginAt` — the only record that the account
 * was ever used — survives it. `purgeAdminUser` below is the irreversible half,
 * and it can only be reached from the archive.
 *
 * `isActive` is deliberately left as it was. Setting it to `false` here would
 * be tidier to reason about, but it would also make «Відновити» silently
 * re-enable an account that was switched off before it was archived, which is
 * not what the operator asked for. The gate treats archived as closed whatever
 * that flag says (`sessionStillValid`), so nothing is left open by it.
 *
 * Sessions end immediately, in the same statement, and the same last-admin
 * guard as `updateAdminUser` applies for the same reason: archiving the only
 * active admin leaves nobody able to create an account again, and the way out
 * of that is `pnpm admin:user` on somebody's laptop. The check and the write
 * are one transaction, since a count is meaningless if the rows it is about can
 * change between reading and writing.
 *
 * **And, exactly like `updateAdminUser`'s, the panel cannot reach that refusal
 * today** — worth saying rather than leaving as a guard somebody assumes is
 * doing work. `/users` refuses archiving your own row, so whoever is archiving
 * is another active admin and is therefore always one of the "others" the count
 * asks about; driven through the real screen it is never zero. What it covers
 * is everything that is not that screen, and the day self-archiving becomes
 * allowed.
 */
export async function archiveAdminUser(txDb: TxDb, id: string): Promise<AdminUserResult> {
  return txDb.transaction(async (tx) => {
    const [current] = await tx
      .select({ role: adminUsers.role, isActive: adminUsers.isActive, archivedAt: adminUsers.archivedAt })
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .limit(1);

    if (!current) return { ok: false, reason: 'not_found' };
    // Already archived by another tab. Nothing to do, and saying «not found»
    // about a row sitting in the archive would be a lie.
    if (current.archivedAt !== null) return { ok: true };

    if (current.role === 'admin' && current.isActive) {
      const [others] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(adminUsers)
        .where(
          and(
            ne(adminUsers.id, id),
            eq(adminUsers.role, 'admin'),
            eq(adminUsers.isActive, true),
            isNull(adminUsers.archivedAt),
          ),
        );

      if ((others?.count ?? 0) === 0) return { ok: false, reason: 'last_admin' };
    }

    const now = new Date();
    await tx
      .update(adminUsers)
      .set({ archivedAt: now, sessionsValidFrom: now, updatedAt: now })
      .where(eq(adminUsers.id, id));

    return { ok: true };
  });
}

/**
 * «Відновити» — back into the list, in the state it was removed in.
 *
 * `sessionsValidFrom` is stamped on the way in as well as on the way out, for
 * the reason `updateAdminUser` documents at length: archive and restore inside
 * the same second would otherwise leave a token the gate had been refusing
 * suddenly acceptable again. It costs nothing, because an archived account has
 * no live session to end.
 *
 * The `IS NOT NULL` in the filter is what makes this idempotent rather than a
 * way to touch a live row: only something in the archive can be restored.
 */
export async function restoreAdminUser(db: Db, id: string): Promise<AdminUserResult> {
  const now = new Date();
  const updated = await db
    .update(adminUsers)
    .set({ archivedAt: null, sessionsValidFrom: now, updatedAt: now })
    .where(and(eq(adminUsers.id, id), isNotNull(adminUsers.archivedAt)))
    .returning({ id: adminUsers.id });

  return updated.length > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
}

/**
 * «Видалити назавжди» — the row is gone, and with it the record that the
 * account ever existed. This is the only thing that frees the address for a new
 * account, which is the reason it exists at all.
 *
 * **Only an archived row can be purged**, and that is enforced here rather than
 * on the screen: the filter is the reason a hand-made POST naming a live
 * colleague's id cannot delete them, however the button was rendered. Reaching
 * this deliberately takes two separate actions — archive, then purge from the
 * other tab — so there is no single click anywhere in the panel that destroys
 * an account.
 *
 * No last-admin guard, and none is needed: an archived row is by definition not
 * an active admin, so `archiveAdminUser` already refused if this was the last
 * one.
 *
 * `confirmEmail` is the address the operator typed back, and it is part of the
 * `WHERE` rather than compared beforehand — so a row restored between reading
 * the screen and pressing the button is not deleted by a check that passed a
 * moment earlier. The follow-up read happens **only when nothing was deleted**,
 * and exists purely to say which of the three guards refused; a single
 * statement cannot tell «already gone» from «restored in another tab» from «you
 * typed the wrong address», and those are three different things to do next.
 */
export async function purgeAdminUser(
  db: Db,
  id: string,
  confirmEmail: string,
): Promise<AdminUserResult> {
  const deleted = await db
    .delete(adminUsers)
    .where(
      and(
        eq(adminUsers.id, id),
        isNotNull(adminUsers.archivedAt),
        eq(adminUsers.email, normalizeEmail(confirmEmail)),
      ),
    )
    .returning({ id: adminUsers.id });

  if (deleted.length > 0) return { ok: true };

  const [row] = await db
    .select({ archivedAt: adminUsers.archivedAt })
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);

  if (!row) return { ok: false, reason: 'not_found' };
  if (row.archivedAt === null) return { ok: false, reason: 'not_archived' };
  return { ok: false, reason: 'confirm_email' };
}
