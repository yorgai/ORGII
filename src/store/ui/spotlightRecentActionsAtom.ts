/**
 * Spotlight Recent Actions Atom
 *
 * Persists the ids of recently-used global Spotlight commands (most-recent
 * first) to localStorage so the "Recently used" group survives app restarts.
 * Pure list logic (add/dedupe/cap) lives in
 * `@src/scaffold/GlobalSpotlight/hooks/features/recentSpotlightActions`.
 */
import { atomWithStorage } from "jotai/utils";

export const spotlightRecentActionsAtom = atomWithStorage<string[]>(
  "orgii-spotlight-recent-actions",
  []
);
spotlightRecentActionsAtom.debugLabel = "spotlightRecentActionsAtom";
