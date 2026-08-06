import { z } from 'zod';

/**
 * The `q` parameter of `/search`, normalised into the tokens the DB query runs on.
 *
 * Lives here rather than in the page because both sides need the same answer:
 * the page renders «за запитом «…»» from the normalised string, and the query
 * builder matches on the tokens. Splitting the two invites a result set that
 * does not match the query echoed back above it.
 */

/** Also the `maxlength` on the input. Nothing useful is longer. */
export const MAX_SEARCH_QUERY = 64;

/** Below this a token matches almost everything, so it is dropped as noise. */
const MIN_TOKEN_LENGTH = 2;

/**
 * Every extra token is another `ILIKE` over the same row. Six words is already
 * far past anything that returns a result, so the rest are cut rather than paid
 * for on every request.
 */
const MAX_TOKENS = 6;

/**
 * Collapses whitespace and caps the length. Never throws: `q` is a URL
 * parameter, so a missing, repeated or absurd value has to degrade into "no
 * query" rather than into a 500.
 */
export const searchQuerySchema = z
  .string()
  .transform((raw) => raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_QUERY).trim())
  .catch('');

export function parseSearchQuery(raw: string | null | undefined): string {
  return searchQuerySchema.parse(raw ?? '');
}

/**
 * Splits a normalised query into the words that must *all* appear in a product.
 *
 * Short words are dropped — but only while something longer survives. A query
 * that is nothing but short words («ID», a SKU fragment) is searched as typed;
 * returning the whole catalogue because every token was filtered away is worse
 * than a broad match.
 */
export function searchTokens(query: string): string[] {
  const words = query.split(' ').filter(Boolean);
  const meaningful = words.filter((word) => word.length >= MIN_TOKEN_LENGTH);

  return (meaningful.length > 0 ? meaningful : words).slice(0, MAX_TOKENS);
}
