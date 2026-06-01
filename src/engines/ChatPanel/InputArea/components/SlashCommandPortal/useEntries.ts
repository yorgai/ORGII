import { useMemo } from "react";

import { AGENT_EXEC_MODES } from "@src/config/sessionCreatorConfig";
import type { SlashItem } from "@src/types/extensions";
import { fuzzyMatch } from "@src/util/search/fuzzy";

import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  FLYOUT_CATEGORIES,
} from "./constants";
import type { ListEntry } from "./types";

interface UseEntriesOptions {
  items: SlashItem[];
  searchQuery: string;
  /** Show Mode / Models flyout triggers + Image row (true = + button menu). */
  showActionFlyouts: boolean;
  hasImageUpload: boolean;
  /** When true and items is still empty, render placeholder flyout triggers. */
  loading?: boolean;
}

interface UseEntriesResult {
  entries: ListEntry[];
  totalFlat: number;
}

/**
 * Builds the unified flat-list entries for the slash command menu.
 *
 * Layout when showActionFlyouts=true and not searching:
 *   Mode flyout trigger
 *   Divider
 *   Image row (if hasImageUpload)
 *   Models flyout trigger
 *   Skills flyout trigger (if any skills)
 *   MCP Servers flyout trigger (if any tools)
 *   Actions flat list (if any action items)
 *
 * Layout when showActionFlyouts=false (inline / typing mode):
 *   Slash item categories only (flat or flyout per category)
 *
 * When searching, flyout categories are expanded inline for scannable results.
 */
export function useEntries({
  items,
  searchQuery,
  showActionFlyouts,
  hasImageUpload,
  loading = false,
}: UseEntriesOptions): UseEntriesResult {
  return useMemo(() => {
    const result: ListEntry[] = [];
    let idx = 0;
    const isSearching = Boolean(searchQuery);

    if (showActionFlyouts && !isSearching) {
      // Mode flyout trigger
      result.push({ kind: "mode-flyout", flatIndex: idx++ });

      // Divider between mode/image/models and skills/tools
      result.push({ kind: "divider" });

      // Image upload row
      if (hasImageUpload) {
        result.push({ kind: "image", flatIndex: idx++ });
      }

      // Models flyout trigger
      result.push({ kind: "models-flyout", flatIndex: idx++ });

      // Slash item categories as flyout triggers (no search)
      const hasSkillOrTool = items.some(
        (i) => i.category === "skill" || i.category === "tool"
      );

      for (const category of CATEGORY_ORDER) {
        const catItems = items.filter((item) => item.category === category);

        if (FLYOUT_CATEGORIES.has(category)) {
          if (catItems.length > 0) {
            result.push({
              kind: "flyout",
              category,
              label: CATEGORY_LABELS[category],
              items: catItems,
              flatIndex: idx++,
            });
          } else if (loading && !hasSkillOrTool) {
            // While the first fetch is in-flight, render a disabled placeholder
            // so the layout doesn't jump once data arrives.
            result.push({
              kind: "flyout",
              category,
              label: CATEGORY_LABELS[category],
              items: [],
              flatIndex: idx++,
            });
          }
        } else {
          if (catItems.length === 0) continue;
          result.push({ kind: "header", label: CATEGORY_LABELS[category] });
          for (const item of catItems) {
            result.push({ kind: "item", item, flatIndex: idx++ });
          }
        }
      }

      return { entries: result, totalFlat: idx };
    }

    // ── Inline / search path ─────────────────────────────────────────────────

    // Mode rows when showActionFlyouts=false and searching (filter by query)
    if (!showActionFlyouts && isSearching) {
      const matchedModes = AGENT_EXEC_MODES.filter(
        (m) => fuzzyMatch(searchQuery, m.name) || fuzzyMatch(searchQuery, m.id)
      );
      if (matchedModes.length > 0) {
        result.push({ kind: "header", label: "Mode" });
        for (const mode of matchedModes) {
          result.push({ kind: "mode", mode, flatIndex: idx++ });
        }
      }
    }

    // Slash item categories (flat when searching, flyout when not)
    for (const category of CATEGORY_ORDER) {
      const catItems = items.filter((item) => item.category === category);
      if (catItems.length === 0) continue;

      if (!isSearching && FLYOUT_CATEGORIES.has(category)) {
        result.push({
          kind: "flyout",
          category,
          label: CATEGORY_LABELS[category],
          items: catItems,
          flatIndex: idx++,
        });
      } else {
        result.push({ kind: "header", label: CATEGORY_LABELS[category] });
        for (const item of catItems) {
          result.push({ kind: "item", item, flatIndex: idx++ });
        }
      }
    }

    return { entries: result, totalFlat: idx };
  }, [items, searchQuery, showActionFlyouts, hasImageUpload, loading]);
}
