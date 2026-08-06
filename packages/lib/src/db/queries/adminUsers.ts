import { eq } from 'drizzle-orm';
import type { Db } from '../index';
import { adminUsers } from '../schema';
import { normalizeEmail } from '../../auth/password';

/**
 * The two reads and two writes the login form needs, and nothing else. Adding
 * and removing admins is `scripts/admin-user.ts` until Phase 4 grows a screen
 * for it; there is deliberately no "list every admin with their hash" helper
 * for a page to reach for by accident.
 */

export interface AdminUserRecord {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
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
      passwordHash: adminUsers.passwordHash,
      isActive: adminUsers.isActive,
    })
    .from(adminUsers)
    .where(eq(adminUsers.email, normalizeEmail(email)))
    .limit(1);

  if (!row || !row.isActive) return null;

  return { id: row.id, email: row.email, name: row.name, passwordHash: row.passwordHash };
}

/** Stamped after a successful login. Best-effort: never block a sign-in on it. */
export async function recordAdminLogin(db: Db, id: string): Promise<void> {
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, id));
}

/**
 * Replace a stored hash with one at the current cost. Called only from a
 * successful login, which is the one moment the plaintext exists to re-derive
 * from — see `needsRehash` in `~/lib/auth/password`.
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
