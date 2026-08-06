/**
 * Wraps a token in `%…%` and escapes the LIKE metacharacters, so a query of
 * `50%` looks for that text rather than for anything at all.
 *
 * Backslash is Postgres' default LIKE escape character, so no `ESCAPE` clause
 * is needed — but it does mean a literal backslash has to be doubled first.
 *
 * Shared by `/search` (`./products.ts`) and the admin order list
 * (`./orders.ts`): the escaping rule is a correctness detail, not a per-query
 * preference, and it should have exactly one definition.
 */
export function likeContains(token: string): string {
  return `%${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
