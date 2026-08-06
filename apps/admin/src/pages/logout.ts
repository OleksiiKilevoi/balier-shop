import type { APIRoute } from 'astro';
import { SESSION_COOKIE, sessionCookieOptions } from '@balier/lib/auth';

/**
 * Sign out: clear the session cookie and go back to the form.
 *
 * POST only, and that is not ceremony — a `GET /logout` would be followed
 * by any link prefetcher, crawler or over-eager browser optimisation that saw
 * the URL, and would sign the operator out at random. As a form POST it also
 * inherits Astro's origin check, so another site cannot log them out either.
 *
 * Public in `src/middleware.ts` alongside the login form: signing out has to
 * work when the session it is clearing has already lapsed, which is exactly
 * when the gate would otherwise bounce the request to the login page with the
 * dead cookie still in the browser.
 *
 * The attributes must match `sessionCookieOptions` exactly — a `Set-Cookie`
 * that differs in `path` or `secure` creates a second cookie instead of
 * removing the first.
 */
export const prerender = false;

export const POST: APIRoute = ({ cookies, redirect }) => {
  const { path, httpOnly, secure, sameSite } = sessionCookieOptions();
  cookies.delete(SESSION_COOKIE, { path, httpOnly, secure, sameSite });

  return redirect('/login?message=signed_out', 303);
};

/** Nothing to do here; the panel's own control is a form. */
export const GET: APIRoute = ({ redirect }) => redirect('/', 303);
