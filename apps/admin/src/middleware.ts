import { defineMiddleware, sequence } from 'astro:middleware';
import type { AstroCookies } from 'astro';
import { env } from 'cloudflare:workers';
import * as Sentry from '@sentry/cloudflare';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  sessionStillValid,
  verifySession,
} from '@balier/lib/auth';
import { createDb } from '@balier/lib/db';
import { findActiveAdminById } from '@balier/lib/db/queries/adminUsers';

/**
 * The admin gate, inverted: on this Worker every route needs a valid session
 * cookie, minted by `/login` against `admin_users`, except the short allowlist
 * below. The panel used to live under `/admin/**` on the storefront Worker;
 * since the split it owns its whole hostname, so "is this an admin path" is no
 * longer a question — everything here is.
 *
 * This replaced a Cloudflare Access JWT check. The reason is ownership, not
 * security — Access worked — the panel is meant to be lifted into the next
 * business, and a gate that lives in one Cloudflare account's Zero Trust
 * dashboard does not travel with the code. The property that mattered most
 * about the old gate is kept exactly: **the check is in the application**, so
 * it holds on the `workers.dev` URL and anywhere else the Worker is reachable,
 * with no edge configuration to get wrong.
 *
 * Unconfigured still means denied. With `ADMIN_SESSION_SECRET` unset, nothing
 * verifies and every request here is turned away — including ours.
 *
 * There is **no development bypass**, unlike the gate this replaced. That one
 * needed it (nothing authenticates in front of `pnpm dev`); this one does not,
 * because the form works locally. So the login path that ships is the login
 * path that gets exercised every day. `scripts/admin-user.ts` creates the
 * account to log in with.
 */
export const LOGIN_PATH = '/login';

/**
 * The routes that must answer without a session: the two sign-in forms (or
 * nobody could ever get a session), sign-out (which only clears a cookie, and
 * has to work even when the session behind it has already lapsed),
 * `/telegram/webhook` — Telegram's deliveries, which cannot hold a session
 * and carry their own `secret_token` authentication instead — and `/media/**`
 * — the image previews the editor pages render. Media keys are content hashes
 * from a closed character set, and the same objects are public on the
 * storefront anyway, so an unauthenticated fetch here learns nothing.
 */
const PUBLIC_PATHS = new Set<string>([LOGIN_PATH, '/login/telegram', '/logout', '/telegram/webhook']);
const PUBLIC_PREFIXES = ['/media/'] as const;

/**
 * Ahead of the gate on purpose, so it also sees the routes the gate lets
 * through without a session (`/login`, `/telegram/webhook` — whose deliberate
 * 500-on-thrown-query is exactly what Sentry must catch). Captured errors are
 * **rethrown**, never swallowed (`docs/plans/sentry.md`); options are built
 * per request from `env` — no module-scope state (hard rule 4).
 */
const sentry = defineMiddleware((context, next) => {
  return Sentry.wrapRequestHandler(
    {
      options: {
        dsn: env.SENTRY_DSN,
        environment: env.SENTRY_ENVIRONMENT,
        // Errors only — no performance tracing.
        tracesSampleRate: 0,
        // One Sentry project for all three Workers; this tag tells them apart.
        initialScope: { tags: { worker: 'admin' } },
      },
      request: context.request,
      context: context.locals.cfContext,
    },
    () => next(),
  );
});

const gate = defineMiddleware(async ({ url, cookies, locals }, next) => {
  const pathname = url.pathname;
  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return next();
  }

  const session = await verifySession(env.ADMIN_SESSION_SECRET, cookies.get(SESSION_COOKIE)?.value);
  if (!session) return unauthorized(url);

  /*
   * The signature proves the token was minted here and has not been edited. It
   * cannot prove the account still wants it — so the row is read, every
   * request. See `sessionStillValid`: a disabled account and a token older than
   * the account's `sessions_valid_from` are both turned away here rather than
   * at the end of a twelve-hour day.
   *
   * The cost is one Neon round trip per page the panel serves, which is the
   * price of revocation without a session table, on a panel with a handful of
   * accounts. `locals.adminUser` carries the row on to the page so the screens
   * that need it — `/settings` — do not read it a second time.
   */
  let user;
  try {
    user = await findActiveAdminById(createDb(env.DATABASE_URL), session.sub);
  } catch {
    // The database is unreachable. Deny, and say so: the same rule the rest of
    // this gate is built on, since "we cannot check" is not "come in". The
    // cookie is left alone — this is our outage, not their session's fault.
    return unavailable();
  }

  if (!user || !sessionStillValid(session, user)) return signedOut(url, cookies);

  locals.admin = session;
  locals.adminUser = user;
  return next();
});

/**
 * The panel is a subdomain of the shop's Search Console property; the layout
 * already carries a robots meta tag, this header covers what has no
 * `<head>` — PDFs, redirects, the login page's 303s.
 */
const noindex = defineMiddleware(async (_context, next) => {
  const response = await next();
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
});

export const onRequest = sequence(sentry, noindex, gate);

/**
 * Land on the form, with the address the operator was trying to reach carried
 * along so the login finishes the journey. (The old JSON-401 branch for
 * `/api/**` is gone with the split — this Worker has no API routes; admin
 * mutations are form POSTs to the pages themselves.)
 */
function unauthorized(url: URL, message?: string): Response {
  const target = new URL(LOGIN_PATH, url);
  // Path and query only. `next` is re-validated on the way out in
  // `login.astro` — this is a hint, not a trusted instruction.
  if (url.pathname !== '/') target.searchParams.set('next', `${url.pathname}${url.search}`);
  if (message) target.searchParams.set('message', message);

  return new Response(null, {
    status: 303,
    headers: { location: `${target.pathname}${target.search}`, 'cache-control': 'no-store' },
  });
}

/**
 * A token that verifies but whose account no longer honours it: switched off,
 * or every session revoked by a password change.
 *
 * The cookie is cleared on the way out rather than left to expire. It is dead
 * either way, but a browser still holding it would keep sending it, and the
 * operator would keep paying a database read to be turned away — and «сесія
 * завершилася» next to a cookie that is visibly still there reads like a bug.
 *
 * Cleared through `cookies.delete` with `sessionCookieOptions`, the same call
 * `/logout` makes: the attributes have to match the ones it was set with
 * exactly, or the browser adds a second cookie instead of removing the first,
 * and spelling them out here by hand is how they drift.
 */
function signedOut(url: URL, cookies: AstroCookies): Response {
  const { path, httpOnly, secure, sameSite } = sessionCookieOptions();
  cookies.delete(SESSION_COOKIE, { path, httpOnly, secure, sameSite });

  return unauthorized(url, 'session_expired');
}

/**
 * Neon is unreachable, so the gate cannot tell a live session from a revoked
 * one. Fail closed, and do not redirect: bouncing to a login form that also
 * needs the database would spend the outage in a loop.
 */
function unavailable(): Response {
  return new Response('Панель тимчасово недоступна. Спробуйте за хвилину.', {
    status: 503,
    headers: { 'content-type': 'text/plain;charset=utf-8', 'cache-control': 'no-store' },
  });
}
