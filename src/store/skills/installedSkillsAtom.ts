import { atom } from "jotai";

import type { InstalledSkill } from "@src/types/extensions";

/**
 * Global cache for the installed skills list. Persists across component
 * mount/unmount cycles (e.g. wizard open/close navigation) so the list
 * is immediately visible after an import without requiring a page reload.
 */
export const installedSkillsAtom = atom<InstalledSkill[]>([]);
export const installedSkillsLoadingAtom = atom<boolean>(true);
