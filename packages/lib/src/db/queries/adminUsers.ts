import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Db, TxDb } from '../index';
import { adminUsers } from '../schema';
import type { AdminRole } from '../schema';
import { normalizeEmail } from '../../auth/password';
import { uniqueConstraint } from './unique';

/**
 * The login form's reads and writes, and the «Користувачі» section of
 * `/settings`.
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
}

/**
 * The row a login attempt is checked against. **Inactive users are not
 * returned** — deactivating an account has to be indistinguishable from never
 * having had one, and doing that filtering here means no call site can forget.
 */
export async function findActiveAdminByEmail(
  db: Db,
  email: string,
): Promise<AdminUserRecord | null> {
  const [row] = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      role: adminUsers.role,
      passwordHash: adminUsers.passwordHash,
      sessionsValidFrom: adminUsers.sessionsValidFrom,
      isActive: adminUsers.isActive,
    })
    .from(adminUsers)
    .where(eq(adminUsers.email, normalizeEmail(email)))
    .limit(1);

  if (!row || !row.isActive) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    passwordHash: row.passwordHash,
    sessionsValidFrom: row.sessionsValidFrom,
    isActive: row.isActive,
  };
}

/**
 * The signed-in user's own row, by the id in their session cookie. **This is
 * the gate's read** — `src/middleware.ts` calls it on every request the panel
 * serves, and hands the result to the page in `locals` so nothing reads it
 * twice.
 *
 * Three things depend on it being live rather than carried in the token, which
 * is signed but cannot be withdrawn: `isActive` (the account still exists),
 * `sessionsValidFrom` (the token has not been revoked — `sessionStillValid`),
 * and `role` (a demotion takes effect on the next request, not at the end of
 * the day).
 *
 * Inactive comes back `null`, exactly as at login: one filter, no call site
 * able to forget it.
 */
export async function findActiveAdminById(db: Db, id: string): Promise<AdminUserRecord | null> {
  const [row] = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      role: adminUsers.role,
      passwordHash: adminUsers.passwordHash,
      sessionsValidFrom: adminUsers.sessionsValidFrom,
      isActive: adminUsers.isActive,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);

  if (!row || !row.isActive) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    passwordHash: row.passwordHash,
    sessionsValidFrom: row.sessionsValidFrom,
    isActive: row.isActive,
  };
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

/* ------------------------------------------------- the «Користувачі» section */

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/**
 * Every account, for the admin-only list on `/settings`. Disabled ones included
 * — hiding them would leave no way to switch one back on, and «this address is
 * already taken» with nothing on screen using it is a mystery, not an answer.
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
  | { ok: false; reason: 'email_taken' | 'last_admin' | 'not_found' };

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
 * than leaving as a guard somebody assumes is doing work.** `/settings` refuses
 * self-demotion and self-disabling outright, so whoever is making the change is
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
          and(ne(adminUsers.id, id), eq(adminUsers.role, 'admin'), eq(adminUsers.isActive, true)),
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
