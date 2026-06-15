/**
 * Recent Spotlight Actions — pure list logic
 *
 * Maintains the "Recently used" ordering for spotlight commands. All functions
 * here are pure (no React, no persistence) so they can be unit tested in
 * isolation; the persistence layer lives in
 * `@src/store/ui/spotlightRecentActionsAtom` and the rendering lives in
 * `useSpotlightItems`.
 */

/** Max number of recently-used commands kept, most-recent-first. */
export const RECENT_SPOTLIGHT_ACTIONS_CAP = 6;

/**
 * Returns a new recent-id list with `id` promoted to the front.
 *
 * - De-duplicates: re-using a command moves it to the top instead of adding a
 *   second entry.
 * - Caps the list length at `cap`, dropping the oldest entries.
 */
export function addRecentActionId(
  current: readonly string[],
  id: string,
  cap: number = RECENT_SPOTLIGHT_ACTIONS_CAP
): string[] {
  const withoutDuplicate = current.filter((existing) => existing !== id);
  const next = [id, ...withoutDuplicate];
  if (cap <= 0) return [];
  return next.slice(0, cap);
}

/**
 * Resolves recent command ids back to their definitions, preserving the
 * recent (most-recent-first) order. Ids that no longer map to a known
 * definition are silently skipped.
 */
export function resolveRecentDefinitions<T extends { id: string }>(
  recentIds: readonly string[],
  definitions: readonly T[]
): T[] {
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition])
  );
  const resolved: T[] = [];
  for (const id of recentIds) {
    const definition = definitionById.get(id);
    if (definition) resolved.push(definition);
  }
  return resolved;
}
