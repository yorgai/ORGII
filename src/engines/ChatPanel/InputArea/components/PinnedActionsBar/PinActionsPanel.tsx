/**
 * PinActionsPanel
 *
 * A floating search panel opened by the "..." button in PinnedActionsBar.
 * Lists all available slash items (skills + MCP tools + builtins) and lets
 * the user pin or unpin them. Renders via a React portal so it's never
 * clipped by the parent's overflow.
 */
import { Pin, PinOff, Search } from "lucide-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import type { PinnedAction } from "@src/store/session/pinnedActionsAtom";
import type { SlashItem } from "@src/types/extensions";
import { fuzzyMatch, fuzzyScore } from "@src/util/search/fuzzy";

// ── helpers ───────────────────────────────────────────────────────────────────

function actionKey(a: PinnedAction | SlashItem): string {
  return `${a.category}|${a.source}|${a.name}`;
}

function slashItemToAction(item: SlashItem): PinnedAction {
  return {
    name: item.name,
    skillName: item.skillName,
    category: item.category,
    source: item.source,
    serverName: item.serverName,
  };
}

// ── component ─────────────────────────────────────────────────────────────────

interface PinActionsPanelProps {
  /** Whether the panel is visible. */
  visible: boolean;
  /** Bounding rect of the trigger button — used to position the panel. */
  anchorRect: DOMRect | null;
  /** All available slash items to choose from. */
  availableItems: SlashItem[];
  /** Currently pinned actions. */
  pinnedActions: PinnedAction[];
  /** Called when the user pins or unpins an item. */
  onTogglePin: (action: PinnedAction) => void;
  /** Called when the panel should close. */
  onClose: () => void;
  /** Whether items are still loading. */
  loading: boolean;
}

const PinActionsPanel: React.FC<PinActionsPanelProps> = memo(
  ({
    visible,
    anchorRect,
    availableItems,
    pinnedActions,
    onTogglePin,
    onClose,
    loading,
  }) => {
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Reset query and autofocus whenever panel opens.
    useEffect(() => {
      if (visible) {
        requestAnimationFrame(() => {
          setQuery("");
          inputRef.current?.focus();
        });
      }
    }, [visible]);

    // Click-outside closes the panel.
    useEffect(() => {
      if (!visible) return;
      const handler = (e: MouseEvent) => {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
          onClose();
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [visible, onClose]);

    // Escape closes the panel only when focus is inside it, to avoid
    // stealing Escape from the slash command menu or composer.
    useEffect(() => {
      if (!visible) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        if (
          panelRef.current &&
          panelRef.current.contains(document.activeElement)
        ) {
          e.stopPropagation();
          onClose();
        }
      };
      document.addEventListener("keydown", handler, true);
      return () => document.removeEventListener("keydown", handler, true);
    }, [visible, onClose]);

    const pinnedKeys = new Set(pinnedActions.map(actionKey));

    const filteredItems: SlashItem[] = query
      ? availableItems
          .filter(
            (item) =>
              fuzzyMatch(query, item.name) ||
              fuzzyMatch(query, item.description)
          )
          .sort((a, b) => fuzzyScore(query, b.name) - fuzzyScore(query, a.name))
      : availableItems;

    const handleToggle = useCallback(
      (item: SlashItem) => {
        onTogglePin(slashItemToAction(item));
      },
      [onTogglePin]
    );

    if (!visible || !anchorRect) return null;

    // Position: above the anchor, aligned to the right edge of the trigger.
    const PANEL_WIDTH = 240;
    const GAP = 6;
    const top = anchorRect.top - GAP;
    const right = window.innerWidth - anchorRect.right;

    return createPortal(
      <div
        ref={panelRef}
        className={`fixed z-[99999] flex flex-col overflow-hidden ${DROPDOWN_CLASSES.panel}`}
        style={{
          bottom: window.innerHeight - top,
          right,
          width: PANEL_WIDTH,
        }}
      >
        {/* Search header */}
        <div className={DROPDOWN_CLASSES.searchContainer}>
          <Search size={13} className="shrink-0 text-text-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions to pin…"
            className={DROPDOWN_CLASSES.searchInput}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>

        {/* List */}
        <div
          className={`max-h-[280px] overflow-y-auto scrollbar-hide ${DROPDOWN_PANEL.paddingClass}`}
        >
          {loading && filteredItems.length === 0 && (
            <div className="px-2 py-2 text-[12px] text-text-3">Loading…</div>
          )}
          {!loading && filteredItems.length === 0 && (
            <div className="px-2 py-2 text-[12px] text-text-3">
              No actions found.
            </div>
          )}
          {filteredItems.map((item) => {
            const key = actionKey(item);
            const isPinned = pinnedKeys.has(key);
            return (
              <button
                key={key}
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fill-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleToggle(item);
                }}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[12px] font-medium text-text-1">
                    {item.name}
                  </span>
                  {item.source && (
                    <span className="truncate text-[11px] text-text-3">
                      {item.source}
                    </span>
                  )}
                </div>
                <span
                  className={`shrink-0 transition-colors duration-150 ${
                    isPinned
                      ? "text-primary-6"
                      : "text-text-3 hover:text-text-2"
                  }`}
                >
                  {isPinned ? (
                    <PinOff size={13} strokeWidth={1.75} />
                  ) : (
                    <Pin size={13} strokeWidth={1.75} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>,
      document.body
    );
  }
);

PinActionsPanel.displayName = "PinActionsPanel";

export { actionKey, slashItemToAction };
export default PinActionsPanel;
