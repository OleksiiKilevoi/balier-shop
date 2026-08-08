/**
 * Where to go after signing in — shared by both sign-in pages (`/login`,
 * `/login/telegram`), because they redeem the same `?next=` and must discard
 * the same garbage. Anything that is not a path inside the panel is dropped
 * rather than followed: `next` arrives in a URL, so an unchecked value here is
 * an open redirect — a link to our own login page that lands the operator,
 * freshly authenticated, on someone else's site.
 */
export function safeNext(value: string | null): string {
  if (!value) return '/';

  // Every path on this hostname is inside the panel, so "a local path" is
  // the whole test: one leading `/`, not two — `//host` and `/\host` are
  // protocol-relative URLs to another host rather than local paths at all.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';

  return value;
}
