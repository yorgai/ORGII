/**
 * PinActionsPanel
 *
 * A floating search panel opened by the "..." button in PinnedActionsBar.
 * Lists all available slash items (skills + MCP tools + builtins) and lets
 * the user pin or unpin them. Renders via a React portal so it's never
 * clipped by the parent's overflow.
 */
import { ArrowUp, Pin, PinOff, Search } from "lucide-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";
import type { PinnedAction } from "@src/store/session/pinnedActionsAtom";
import type { SlashItem } from "@src/types/extensions";
import { fuzzyMatch, fuzzyScore } from "@src/util/search/fuzzy";
import { getViewportSize } from "@src/util/ui/window/viewport";

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
  /** All available slash items to choose from. */
  availableItems: SlashItem[];
  /** Currently pinned actions. */
  pinnedActions: PinnedAction[];
  /** Called when the user pins or unpins an item. */
  onTogglePin: (action: PinnedAction) => void;
  /** Called when the user inserts an item directly into the composer. */
  onInsert: (action: PinnedAction) => void;
  /** Called when the user clicks the "Unpin all" footer action. */
  onUnpinAll: () => void;
  /** Called when the panel should close. */
  onClose: () => void;
  /** Whether items are still loading. */
  loading: boolean;
  /**
   * Ref to the button that toggles this panel. When provided, clicks on the
   * trigger button are excluded from the click-outside handler so the parent's
   * own toggle logic fires without the panel immediately re-opening.
   */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  /**
   * Horizontal alignment of the panel relative to the trigger button.
   * Defaults to "right" so the panel right-aligns to the "…" button when
   * pills sit to its left. When the "…" button is the leftmost element in
   * the bar (no other pills), callers should pass "left" so the panel
   * extends rightward from the button instead of floating to its left.
   */
  align?: "left" | "right";
}

const PinActionsPanel: React.FC<PinActionsPanelProps> = memo(
  ({
    visible,
    availableItems,
    pinnedActions,
    onTogglePin,
    onInsert,
    onUnpinAll,
    onClose,
    loading,
    triggerRef,
    align = "right",
  }) => {
    const { t } = useTranslation("sessions");
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset query and autofocus whenever panel opens.
    useEffect(() => {
      if (visible) {
        requestAnimationFrame(() => {
          setQuery("");
          inputRef.current?.focus();
        });
      }
    }, [visible]);

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

    const handleInsert = useCallback(
      (item: SlashItem) => {
        onInsert(slashItemToAction(item));
      },
      [onInsert]
    );

    const { isPositioned, panelRef, panelPosition, keyboard } =
      useDropdownEngine<HTMLButtonElement, SlashItem>({
        open: visible,
        onOpenChange: (open) => {
          if (!open) onClose();
        },
        anchorRef: triggerRef,
        placement: "top",
        align,
        gap: DROPDOWN_PANEL.triggerGapTight,
        listNavigation: {
          items: filteredItems,
          onSelect: handleToggle,
          initialSelectedIndex: -1,
        },
      });

    if (!visible || !isPositioned) return null;

    const PANEL_WIDTH = 240;
    const VIEWPORT_PADDING = 8;
    const { width: vw } = getViewportSize();
    const alignedLeft =
      panelPosition.right !== undefined
        ? vw - panelPosition.right - PANEL_WIDTH
        : panelPosition.left;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(alignedLeft, vw - PANEL_WIDTH - VIEWPORT_PADDING)
    );

    return createPortal(
      <div
        ref={panelRef}
        className={`fixed z-[99999] flex flex-col ${DROPDOWN_CLASSES.menuPanelWithHeader}`}
        style={{
          top: panelPosition.top,
          bottom: panelPosition.bottom,
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
                {...keyboard.getItemProps(filteredItems.indexOf(item))}
              >
                <div className="flex min-w-0 items-center">
                  <span className="truncate text-[12px] font-medium text-text-1">
                    {item.name}
                  </span>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={t("input.pinnedActions.insert")}
                    className="text-text-3 transition-colors duration-150 hover:text-primary-6"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleInsert(item);
                    }}
                  >
                    <ArrowUp size={DROPDOWN_ITEM.iconSize} strokeWidth={2} />
                  </span>
                  <span
                    className={`transition-colors duration-150 ${
                      isPinned
                        ? "text-primary-6"
                        : "text-text-3 hover:text-text-2"
                    }`}
                  >
                    {isPinned ? (
                      <PinOff
                        size={DROPDOWN_ITEM.iconSize}
                        strokeWidth={1.75}
                      />
                    ) : (
                      <Pin size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        {pinnedActions.length > 0 && (
          <div className={DROPDOWN_CLASSES.footerContainer}>
            <button
              type="button"
              onClick={onUnpinAll}
              className={`${DROPDOWN_CLASSES.menuActionItem} min-w-0`}
              data-dropdown-keyboard-skip="true"
            >
              <span className="truncate text-[12px] font-medium">
                {t("input.pinnedActions.unpinAll")}
              </span>
            </button>
          </div>
        )}
      </div>,
      document.body
    );
  }
);

PinActionsPanel.displayName = "PinActionsPanel";

export { actionKey, slashItemToAction };
export default PinActionsPanel;
