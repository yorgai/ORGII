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
import { useTranslation } from "react-i18next";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import type { PinnedAction } from "@src/store/session/pinnedActionsAtom";
import type { SlashItem } from "@src/types/extensions";
import { fuzzyMatch, fuzzyScore } from "@src/util/search/fuzzy";

/** Skill name for the setup-repo skill that is superseded by the Setup Repo action pill. */
const SETUP_REPO_SKILL_NAME = "setup-repo";

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Stable identity key for a pinned action or slash item.
 *
 * Skills are keyed by `skillName` (the backend token) rather than `source`
 * (the display group label) because the group label can change across
 * installs/renames while `skillName` stays constant.  Using `source` in the
 * key was causing pinned skills to never match their available-item
 * counterpart whenever the resolved group label differed from the label that
 * was originally persisted.
 *
 * Tools are keyed by server name + tool name (both stable identifiers).
 * Built-in actions are keyed by category + name.
 */
function actionKey(a: PinnedAction | SlashItem): string {
  if (a.category === "skill") {
    // skillName is the canonical identifier; fall back to name if absent
    // (covers legacy stored PinnedActions that pre-date the skillName field).
    const token = a.skillName ?? a.name;
    return `skill|${token}`;
  }
  if (a.category === "tool") {
    return `tool|${a.serverName ?? a.source}|${a.name}`;
  }
  // "action" and any future categories
  return `${a.category}|${a.name}`;
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
  /**
   * Ref to the button that toggles this panel. When provided, clicks on the
   * trigger button are excluded from the click-outside handler so the parent's
   * own toggle logic fires without the panel immediately re-opening.
   */
  triggerRef?: React.RefObject<HTMLElement>;
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
    triggerRef,
  }) => {
    const { t } = useTranslation("sessions");
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
    // Clicks on the trigger button are excluded so the parent's toggle logic
    // can run without the panel immediately re-opening (double-toggle).
    useEffect(() => {
      if (!visible) return;
      const handler = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (panelRef.current?.contains(target)) return;
        if (triggerRef?.current?.contains(target)) return;
        onClose();
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [visible, onClose, triggerRef]);

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

    // Exclude the `setup-repo` skill because the `Setup Repo` action pill
    // already covers it.  Showing both creates a confusing duplicate.
    const displayItems = availableItems.filter(
      (item) =>
        !(item.category === "skill" && item.skillName === SETUP_REPO_SKILL_NAME)
    );

    const filteredItems: SlashItem[] = query
      ? displayItems
          .filter(
            (item) =>
              fuzzyMatch(query, item.name) ||
              fuzzyMatch(query, item.description)
          )
          .sort((a, b) => fuzzyScore(query, b.name) - fuzzyScore(query, a.name))
      : displayItems;

    const handleToggle = useCallback(
      (item: SlashItem) => {
        onTogglePin(slashItemToAction(item));
      },
      [onTogglePin]
    );

    if (!visible || !anchorRect) return null;

    const PANEL_WIDTH = 240;
    const GAP = 6;
    const VIEWPORT_PADDING = 8;
    const preferredLeft = anchorRect.left;
    const rightAlignedLeft = anchorRect.right - PANEL_WIDTH;
    const hasRoomOnRight =
      preferredLeft + PANEL_WIDTH <= window.innerWidth - VIEWPORT_PADDING;
    const hasRoomOnLeft = rightAlignedLeft >= VIEWPORT_PADDING;
    const left = Math.min(
      Math.max(
        hasRoomOnRight
          ? preferredLeft
          : hasRoomOnLeft
            ? rightAlignedLeft
            : preferredLeft,
        VIEWPORT_PADDING
      ),
      window.innerWidth - PANEL_WIDTH - VIEWPORT_PADDING
    );
    const bottom = window.innerHeight - (anchorRect.top - GAP);

    return createPortal(
      <div
        ref={panelRef}
        className={`fixed z-[99999] flex flex-col ${DROPDOWN_CLASSES.menuPanelWithHeader}`}
        style={{
          bottom,
          left,
          width: PANEL_WIDTH,
        }}
      >
        {/* Search header */}
        <div className={DROPDOWN_CLASSES.searchContainer}>
          <Search
            size={DROPDOWN_ITEM.iconSize}
            className="shrink-0 text-text-3"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("input.pinnedActions.searchPlaceholder")}
            className={DROPDOWN_CLASSES.searchInput}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>

        {/* List */}
        <div
          className={`max-h-[280px] overflow-y-auto scrollbar-hide ${DROPDOWN_CLASSES.itemsColumnBelowSearch}`}
        >
          {loading && filteredItems.length === 0 && (
            <div className={DROPDOWN_CLASSES.listMessage}>
              {t("input.pinnedActions.loading")}
            </div>
          )}
          {!loading && filteredItems.length === 0 && (
            <div className={DROPDOWN_CLASSES.listMessage}>
              {t("input.pinnedActions.empty")}
            </div>
          )}
          {filteredItems.map((item) => {
            const key = actionKey(item);
            const isPinned = pinnedKeys.has(key);
            return (
              <button
                key={key}
                type="button"
                className={`${DROPDOWN_CLASSES.menuControlItem} min-w-0`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleToggle(item);
                }}
              >
                <div className="flex min-w-0 items-center">
                  <span className="truncate text-[12px] font-medium text-text-1">
                    {item.name}
                  </span>
                </div>
                <span
                  className={`shrink-0 transition-colors duration-150 ${
                    isPinned
                      ? "text-primary-6"
                      : "text-text-3 hover:text-text-2"
                  }`}
                >
                  {isPinned ? (
                    <PinOff size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
                  ) : (
                    <Pin size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
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
