/**
 * Token-based ranked search over the Global Spotlight navigation destinations.
 * Extracted from navDestinations.ts to keep that file under the config line limit.
 */
import { NAV_DESTINATIONS, describeNavDestination } from "./navDestinations";
import type { NavDestination } from "./navDestinationsTypes";

// ============================================================================
// Tokenizer
// ============================================================================

/**
 * Split a string into lowercase tokens. Splits on whitespace, hyphens,
 * slashes, and `?` / `=` / `&` (so URL paths and query params
 * contribute each segment independently — e.g.
 * `...?wizard=key-add` → `["wizard", "key", "add"]`).
 */
function tokenize(source: string): string[] {
  return source
    .toLowerCase()
    .split(/[\s/?&=_.\-›]+/u)
    .filter((token) => token.length > 0);
}

// ============================================================================
// Corpus Builder
// ============================================================================

/**
 * Flatten a destination + its translated label/description into the
 * search corpus used for token matching.
 */
function buildSearchCorpus(
  dest: NavDestination,
  translate: (key: string) => string
): { haystack: string; tokens: Set<string> } {
  const { label, description } = describeNavDestination(dest, translate);
  const parts = [dest.path, label, description, ...(dest.keywords ?? [])];
  const haystack = parts.join(" ").toLowerCase();
  const tokens = new Set<string>();
  for (const part of parts) {
    for (const token of tokenize(part)) tokens.add(token);
  }
  // Keywords are often short phrases — keep the full phrase as a match target
  // too ("api key" should match the literal query "api key" without tokenising).
  for (const kw of dest.keywords ?? []) tokens.add(kw.toLowerCase());
  return { haystack, tokens };
}

// ============================================================================
// Scorer
// ============================================================================

/**
 * Score a destination against the list of query tokens. Higher is better;
 * `null` means no match. Scoring rules (all additive):
 *
 * - +10 per query token that matches a destination token exactly
 * - +5 per query token that is a prefix of a destination token
 * - +2 per query token that appears anywhere in the corpus string
 * - +15 bonus when the full query string appears verbatim in the haystack
 *
 * A destination must match **every** query token to be eligible.
 */
function scoreDestination(
  dest: NavDestination,
  queryTokens: string[],
  rawQuery: string,
  translate: (key: string) => string
): number | null {
  const { haystack, tokens } = buildSearchCorpus(dest, translate);
  let score = 0;

  for (const q of queryTokens) {
    if (tokens.has(q)) {
      score += 10;
      continue;
    }
    let matched = false;
    for (const t of tokens) {
      if (t.startsWith(q)) {
        score += 5;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (haystack.includes(q)) {
      score += 2;
      continue;
    }
    return null; // query token not found anywhere → exclude
  }

  if (haystack.includes(rawQuery)) score += 15;
  return score;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Token-based, ranked search over label, description, path, and keywords.
 * Returns the full registry when `query` is empty. A destination is returned
 * only if **every** whitespace-separated query token is found somewhere in its
 * searchable corpus; results are sorted by score (descending).
 *
 * Pass a `translate` function to match against user-visible translated
 * breadcrumbs — without it the search falls back to path and keywords only.
 */
export function searchNavDestinations(
  query: string,
  translate?: (key: string) => string
): NavDestination[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return NAV_DESTINATIONS;

  const queryTokens = tokenize(trimmed);
  if (queryTokens.length === 0) return NAV_DESTINATIONS;

  const t = translate ?? ((key: string) => key);

  const scored: { dest: NavDestination; score: number; order: number }[] = [];
  NAV_DESTINATIONS.forEach((dest, order) => {
    if (dest.searchable === false) return;
    const score = scoreDestination(dest, queryTokens, trimmed, t);
    if (score !== null) scored.push({ dest, score, order });
  });

  scored.sort((lhs, rhs) => {
    if (rhs.score !== lhs.score) return rhs.score - lhs.score;
    return lhs.order - rhs.order; // stable ties → original registry order
  });

  return scored.map((entry) => entry.dest);
}
