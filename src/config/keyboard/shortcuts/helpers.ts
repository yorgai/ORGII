import { ALL_SHORTCUTS } from "./allShortcuts";
import { CATEGORY_CONFIG } from "./displayConfig";
import type { ShortcutCategory, ShortcutEntry, ShortcutScope } from "./types";

export function getShortcutsByCategory(
  category: ShortcutCategory
): ShortcutEntry[] {
  return ALL_SHORTCUTS.filter((shortcut) => shortcut.category === category);
}

export function getShortcutsByScope(scope: ShortcutScope): ShortcutEntry[] {
  return ALL_SHORTCUTS.filter((shortcut) => shortcut.scope === scope);
}

export function getCategories(): ShortcutCategory[] {
  const categories = [
    ...new Set(ALL_SHORTCUTS.map((shortcut) => shortcut.category)),
  ];
  return categories.sort(
    (catA, catB) =>
      (CATEGORY_CONFIG[catA]?.order ?? 99) -
      (CATEGORY_CONFIG[catB]?.order ?? 99)
  );
}

export function getScopes(): ShortcutScope[] {
  return [...new Set(ALL_SHORTCUTS.map((shortcut) => shortcut.scope))];
}
