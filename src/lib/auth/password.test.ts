import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITERATIONS,
  hashPassword,
  needsRehash,
  normalizeEmail,
  verifyPassword,
} from './password';

/**
 * The iteration count that ships is deliberately expensive, and these tests do
 * not need it — every property here holds at any cost. A low count keeps the
 * suite fast; the two cases that care about the real number say so explicitly.
 */
const FAST = 1_000;

describe('hashPassword', () => {
  it('produces a self-describing string carrying its own cost', async () => {
    const hash = await hashPassword('correct horse battery staple', FAST);

    const [scheme, iterations, salt, derived] = hash.split('$');
    expect(scheme).toBe('pbkdf2-sha256');
    expect(Number(iterations)).toBe(FAST);
    expect(salt).toBeTruthy();
    expect(derived).toBeTruthy();
  });

  it('never repeats itself — the salt is fresh every call', async () => {
    const a = await hashPassword('same password', FAST);
    const b = await hashPassword('same password', FAST);

    expect(a).not.toBe(b);
    // …and both still verify, which is the point of salting at all.
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  it('defaults to the shipped cost', async () => {
    const hash = await hashPassword('slow on purpose');
    expect(hash.split('$')[1]).toBe(String(DEFAULT_ITERATIONS));
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret-passphrase', FAST);

    expect(await verifyPassword('s3cret-passphrase', hash)).toBe(true);
    expect(await verifyPassword('s3cret-passphras', hash)).toBe(false);
    expect(await verifyPassword('S3cret-passphrase', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('survives non-ASCII passwords byte for byte', async () => {
    const hash = await hashPassword('парольПароль123', FAST);

    expect(await verifyPassword('парольПароль123', hash)).toBe(true);
    expect(await verifyPassword('парольпароль123', hash)).toBe(false);
  });

  it('reads the cost out of the stored hash rather than assuming the current one', async () => {
    // The guarantee that lets `DEFAULT_ITERATIONS` be raised later without
    // locking every existing admin out of their own account.
    const old = await hashPassword('unchanged', 500);
    expect(await verifyPassword('unchanged', old)).toBe(true);
  });

  it('says no to anything malformed instead of throwing', async () => {
    const cases = [
      '',
      'plaintext',
      'pbkdf2-sha256$1000$onlythree',
      'pbkdf2-sha256$1000$c2FsdA$aGFzaA$extra',
      'bcrypt$1000$c2FsdA$aGFzaA',
      'pbkdf2-sha256$notanumber$c2FsdA$aGFzaA',
      'pbkdf2-sha256$0$c2FsdA$aGFzaA',
      'pbkdf2-sha256$1000$$aGFzaA',
      'pbkdf2-sha256$1000$c2FsdA$!!!not base64!!!',
    ];

    for (const stored of cases) {
      expect(await verifyPassword('anything', stored)).toBe(false);
    }
  });

  it('rejects a hash of the right shape but the wrong length', async () => {
    const hash = await hashPassword('right', FAST);
    const [scheme, iterations, salt] = hash.split('$');
    // A truncated derived key must not compare equal to its own prefix.
    expect(await verifyPassword('right', `${scheme}$${iterations}$${salt}$YQ`)).toBe(false);
  });
});

describe('needsRehash', () => {
  it('flags a hash cheaper than the current cost, and only that', async () => {
    expect(needsRehash(await hashPassword('x', FAST))).toBe(true);
    expect(needsRehash(await hashPassword('x'), DEFAULT_ITERATIONS)).toBe(false);
    // Someone raised the cost on a machine ahead of ours; leave it alone.
    expect(needsRehash(await hashPassword('x', DEFAULT_ITERATIONS * 2))).toBe(false);
  });

  it('flags anything it cannot parse, so an alien row is replaced', () => {
    expect(needsRehash('not-a-hash')).toBe(true);
    expect(needsRehash('')).toBe(true);
  });
});

describe('normalizeEmail', () => {
  it('lower-cases and trims so one person cannot become two admins', () => {
    expect(normalizeEmail('  Anna@Balier.UA ')).toBe('anna@balier.ua');
    expect(normalizeEmail('anna@balier.ua')).toBe('anna@balier.ua');
  });
});
