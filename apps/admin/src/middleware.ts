import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { SESSION_COOKIE, verifySession } from '@balier/lib/auth';

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
 * The routes that must answer without a session: the form itself (or nobody
 * could ever get one), sign-out (which only clears a cookie, and has to work
 * even when the session behind it has already lapsed), and `/media/**` — the
 * image previews the editor pages render. Media keys are content hashes from a
 * closed character set, and the same objects are public on the storefront
 * anyway, so an unauthenticated fetch here learns nothing.
 */
const PUBLIC_PATHS = new Set<string>([LOGIN_PATH, '/logout']);
const PUBLIC_PREFIXES = ['/media/'] as const;

export const onRequest = defineMiddleware(async ({ url, cookies, locals }, next) => {
  const pathname = url.pathname;
  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return next();
  }

  const session = await verifySession(env.ADMIN_SESSION_SECRET, cookies.get(SESSION_COOKIE)?.value);
  if (!session) return unauthorized(url);

  locals.admin = session;
  return next();
});

/**
 * Land on the form, with the address the operator was trying to reach carried
 * along so the login finishes the journey. (The old JSON-401 branch for
 * `/api/**` is gone with the split — this Worker has no API routes; admin
 * mutations are form POSTs to the pages themselves.)
 */
function unauthorized(url: URL): Response {
  const target = new URL(LOGIN_PATH, url);
  // Path and query only. `next` is re-validated on the way out in
  // `login.astro` — this is a hint, not a trusted instruction.
  if (url.pathname !== '/') target.searchParams.set('next', `${url.pathname}${url.search}`);

  return new Response(null, {
    status: 303,
    headers: { location: `${target.pathname}${target.search}`, 'cache-control': 'no-store' },
  });
}
