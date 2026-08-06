import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config as loadEnv } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import * as schema from '@balier/lib/db/schema';
import { hashPassword, normalizeEmail } from '@balier/lib/auth/password';

/**
 * Create an admin, reset an admin's password, or switch one off.
 *
 *   pnpm admin:user create   <email> [name]
 *   pnpm admin:user password <email>
 *   pnpm admin:user disable  <email>
 *   pnpm admin:user enable   <email>
 *   pnpm admin:user list
 *
 * The panel has no screen for this yet, and until it does this script is the
 * only way an account comes into being — including the first one, which is the
 * chicken-and-egg the login form cannot solve for itself.
 *
 * **The password is never a command-line argument.** It is prompted for, or
 * read from a pipe when there is no terminal (`… | pnpm admin:user create x`),
 * so it does not end up in shell history, in a CI log, or in the process list
 * of a shared machine. It is hashed here and only the hash is sent to the
 * database: this script is the same PBKDF2 code the Worker runs, imported
 * directly, so the two can never drift into producing hashes the other cannot
 * read.
 *
 * Runs against whatever `DATABASE_URL` is in `.dev.vars` — which is the dev
 * Neon database. Pointing it at production means putting the production URL in
 * the environment deliberately.
 */

loadEnv({ path: '.dev.vars', quiet: true });
loadEnv({ quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .dev.vars.example to .dev.vars first.');
  process.exit(1);
}

const db = drizzle(neon(databaseUrl), { schema });

const [command, emailArg, ...rest] = process.argv.slice(2);

/**
 * Long enough that the PBKDF2 work is the attacker's cheapest path. It carries
 * more weight than it used to: the Workers runtime caps the iteration count at
 * 100 000 (`src/lib/auth/password.ts`), so length is the half of the trade that
 * is still ours to set.
 */
const MIN_PASSWORD_LENGTH = 12;

async function readPassword(): Promise<string> {
  // No terminal means the password is being piped in — by a deploy step, or by
  // a password manager's CLI. Asking "repeat it" of a pipe is meaningless, so
  // the confirmation is a terminal-only courtesy against a typo.
  const password = stdin.isTTY ? await promptTwice() : await readAllStdin();

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Too short — use at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  return password;
}

async function promptTwice(): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const password = await rl.question('New password: ');
    const again = await rl.question('Repeat password: ');

    if (password !== again) {
      console.error('Passwords do not match.');
      process.exit(1);
    }

    return password;
  } finally {
    rl.close();
  }
}

async function readAllStdin(): Promise<string> {
  let data = '';
  stdin.setEncoding('utf8');
  for await (const chunk of stdin) data += chunk;

  // A leading BOM is the encoding announcing itself, never part of a password —
  // and PowerShell writes one on every pipe into a native command. Found the
  // hard way: without this, `"pw" | pnpm admin:user create …` stores a hash of
  // U+FEFF + the password, and the browser can then never reproduce it.
  // One trailing newline is the pipe's too. Anything else — leading spaces
  // included — is left exactly as sent.
  return data.replace(/^﻿/, '').replace(/\r?\n$/, '');
}

function requireEmail(): string {
  if (!emailArg) {
    console.error('An email address is required.');
    process.exit(1);
  }
  return normalizeEmail(emailArg);
}

async function findByEmail(email: string) {
  return db.query.adminUsers.findFirst({ where: (u, { eq: is }) => is(u.email, email) });
}

async function main() {
  switch (command) {
    case 'create': {
      const email = requireEmail();
      if (await findByEmail(email)) {
        console.error(`${email} already exists — use \`password\` to reset it.`);
        process.exit(1);
      }

      const passwordHash = await hashPassword(await readPassword());
      await db
        .insert(schema.adminUsers)
        .values({ email, name: rest.join(' ') || null, passwordHash });

      console.log(`Created ${email}.`);
      break;
    }

    case 'password': {
      const email = requireEmail();
      const user = await findByEmail(email);
      if (!user) {
        console.error(`No admin with the address ${email}.`);
        process.exit(1);
      }

      const passwordHash = await hashPassword(await readPassword());
      await db
        .update(schema.adminUsers)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(schema.adminUsers.id, user.id));

      // Worth saying out loud: sessions are signed cookies with no server-side
      // store, so the ones already issued keep working until they expire.
      console.log(`Password updated for ${email}.`);
      console.log('Existing sessions stay valid until they expire (see src/lib/auth/session.ts).');
      break;
    }

    case 'disable':
    case 'enable': {
      const email = requireEmail();
      const isActive = command === 'enable';
      const updated = await db
        .update(schema.adminUsers)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(schema.adminUsers.email, email))
        .returning({ email: schema.adminUsers.email });

      if (updated.length === 0) {
        console.error(`No admin with the address ${email}.`);
        process.exit(1);
      }

      console.log(`${email} is now ${isActive ? 'active' : 'disabled'}.`);
      if (!isActive) {
        console.log('Any session they already hold stays valid until it expires.');
      }
      break;
    }

    case 'list': {
      const rows = await db
        .select({
          email: schema.adminUsers.email,
          name: schema.adminUsers.name,
          isActive: schema.adminUsers.isActive,
          lastLoginAt: schema.adminUsers.lastLoginAt,
        })
        .from(schema.adminUsers);

      if (rows.length === 0) {
        console.log('No admins yet. Create one with `pnpm admin:user create <email>`.');
        break;
      }

      for (const row of rows) {
        const last = row.lastLoginAt ? row.lastLoginAt.toISOString() : 'never';
        console.log(
          `${row.isActive ? '[on] ' : '[off]'} ${row.email}${row.name ? ` (${row.name})` : ''} — last login: ${last}`,
        );
      }
      break;
    }

    default:
      console.error(
        [
          'Usage:',
          '  pnpm admin:user create   <email> [name]',
          '  pnpm admin:user password <email>',
          '  pnpm admin:user disable  <email>',
          '  pnpm admin:user enable   <email>',
          '  pnpm admin:user list',
        ].join('\n'),
      );
      process.exit(1);
  }
}

await main();
