/**
 * UnifiedModelDropdown Component
 *
 * Compact, anchored variant of UnifiedModelPalette. Renders the same
 * model / source selection flow produced by `useUnifiedModelPalette`,
 * but as a small dropdown attached to a trigger element instead of the
 * full-screen Spotlight overlay.
 *
 * The two variants share business logic — only the chrome differs. The
 * active variant is chosen by the `general.modelPickerStyle` setting and
 * dispatched in `ModelPill`.
 */
import { Check, ChevronRight, Search } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import {
  type UseDropdownListNavigationReturn,
  useDropdownEngine,
} from "@src/hooks/dropdown";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import { useFilteredItems } from "@src/hooks/search";

import type { SpotlightItem } from "../../shared";
import type { UnifiedModelPaletteProps } from "./types";
import {
  MODEL_SECTION,
  useUnifiedModelPalette,
} from "./useUnifiedModelPalette";

const DROPDOWN_WIDTH = 320;
const SUBMENU_WIDTH = 260;
const SUBMENU_GAP = 8;
const SUBMENU_VERTICAL_OFFSET = 4;
const LIST_MAX_HEIGHT = 280;
const VIEWPORT_MARGIN = 12;

function getItemData(item: SpotlightItem): Record<string, unknown> {
  return (item.data as Record<string, unknown> | undefined) ?? {};
}

function isHeaderItem(item: SpotlightItem): boolean {
  return getItemData(item).isHeader === true;
}

type SubmenuSide = "left" | "right";

interface DropdownRowProps {
  item: SpotlightItem;
  keyboardProps?: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
  onRowMouseEnter?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  submenuSide?: SubmenuSide;
}

const DropdownRow: React.FC<DropdownRowProps> = ({
  item,
  keyboardProps,
  onRowMouseEnter,
  submenuSide,
}) => {
  const data = getItemData(item);
  const isCurrent = data.isCurrentSelection === true;

  const renderedIcon = useMemo(() => {
    if (isCurrent) {
      return <Check size={16} strokeWidth={2.25} className="text-primary-6" />;
    }
    if (!item.icon) return null;
    if (typeof item.icon === "string") {
      return <i className={`${item.icon} text-[16px] text-text-2`} />;
    }
    return React.createElement(item.icon, {
      size: 16,
      className: "text-text-2",
    });
  }, [item.icon, isCurrent]);

  if (isHeaderItem(item)) {
    return (
      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {item.label}
      </div>
    );
  }

  const labelContent = data.labelContent as React.ReactNode | undefined;
  const rightContent = data.rightContent as React.ReactNode | undefined;
  const rightLabel = data.rightLabel as string | undefined;
  const testId = typeof data.testId === "string" ? data.testId : undefined;
  const handleMouseEnter = (event: React.MouseEvent<HTMLButtonElement>) => {
    keyboardProps?.onMouseEnter();
    onRowMouseEnter?.(event);
  };

  return (
    <button
      type="button"
      data-testid={testId}
      {...keyboardProps}
      onMouseEnter={handleMouseEnter}
      className={`${DROPDOWN_CLASSES.itemCompact} ${DROPDOWN_CLASSES.itemHover} w-full justify-start ${
        isCurrent ? DROPDOWN_CLASSES.itemSelected : ""
      }`}
    >
      {renderedIcon && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {renderedIcon}
        </span>
      )}
      <span
        className={`flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px] ${
          isCurrent ? "text-primary-6" : ""
        }`}
      >
        {labelContent ?? item.label}
      </span>
      {rightContent
        ? rightContent
        : rightLabel && (
            <span className="shrink-0 truncate text-[12px] text-text-3">
              {rightLabel}
            </span>
          )}
      {submenuSide && (
        <ChevronRight size={14} className="shrink-0 text-text-3" />
      )}
    </button>
  );
};

export interface UnifiedModelDropdownProps extends UnifiedModelPaletteProps {
  /** Element the dropdown is anchored to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Preferred vertical placement. Defaults to opening below the trigger. */
  placement?: "bottom" | "top";
}

export const UnifiedModelDropdown: React.FC<UnifiedModelDropdownProps> = ({
  isOpen,
  onClose,
  advancedConfig,
  onConfigChange,
  dispatchCategoryOverride,
  cliAgentTypeOverride,
  anchorRef,
  placement = "bottom",
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const tauriSelectAll = useTauriSelectAllShortcut();

  const { sideMenuRawItems, sourceItems, selectedModelId, tCommon } =
    useUnifiedModelPalette({
      isOpen,
      onClose,
      advancedConfig,
      onConfigChange,
      dispatchCategoryOverride,
      cliAgentTypeOverride,
    });

  const [searchQuery, setSearchQuery] = useState("");
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuSelectedIndex, setSubmenuSelectedIndex] = useState(0);
  const [submenuAnchorTop, setSubmenuAnchorTop] = useState<number | null>(null);

  const { filteredItems } = useFilteredItems({
    items: sideMenuRawItems,
    searchQuery,
    getSearchText: (item: SpotlightItem) => {
      const data = getItemData(item);
      const rightLabel = (data.rightLabel as string | undefined) ?? "";
      const searchAlias = (data.searchAlias as string | undefined) ?? "";
      return `${item.label} ${item.desc || ""} ${rightLabel} ${searchAlias}`;
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      setSearchQuery("");
      setSubmenuOpen(false);
      setSubmenuSelectedIndex(0);
      setSubmenuAnchorTop(null);
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const itemUsesSourceSubmenu = useCallback((item: SpotlightItem) => {
    return getItemData(item).modelSection === MODEL_SECTION.ALL;
  }, []);

  const openSourcesForItem = useCallback(
    (item: SpotlightItem, anchorTop?: number) => {
      if (isHeaderItem(item) || !itemUsesSourceSubmenu(item)) return;
      item.action?.();
      setSubmenuOpen(true);
      setSubmenuSelectedIndex(0);
      if (anchorTop !== undefined) setSubmenuAnchorTop(anchorTop);
    },
    [itemUsesSourceSubmenu]
  );

  const handleSelect = useCallback(
    (item: SpotlightItem) => {
      if (isHeaderItem(item)) return;
      if (itemUsesSourceSubmenu(item)) {
        openSourcesForItem(item);
        return;
      }
      item.action?.();
    },
    [itemUsesSourceSubmenu, openSourcesForItem]
  );

  const { isPositioned, panelRef, panelPosition, keyboard } = useDropdownEngine<
    HTMLElement,
    SpotlightItem
  >({
    open: isOpen,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    anchorRef,
    placement,
    gap: DROPDOWN_PANEL.triggerGap,
    closeOnEsc: false,
    listNavigation: {
      items: filteredItems,
      onSelect: handleSelect,
      isItemSelectable: (item) => !isHeaderItem(item),
      initialSelectedIndex: -1,
    },
  });

  const effectiveSubmenuOpen =
    submenuOpen && Boolean(selectedModelId) && sourceItems.length > 0;
  const effectiveSubmenuSelectedIndex = Math.min(
    submenuSelectedIndex,
    Math.max(sourceItems.length - 1, 0)
  );

  const selectSubmenuSource = useCallback(
    (index: number) => {
      const sourceItem = sourceItems[index];
      if (!sourceItem) return;
      sourceItem.action?.();
    },
    [sourceItems]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (effectiveSubmenuOpen) {
          setSubmenuOpen(false);
          return;
        }
        onClose();
        return;
      }

      if (effectiveSubmenuOpen) {
        switch (event.key) {
          case "ArrowDown":
            event.preventDefault();
            setSubmenuSelectedIndex((prev) =>
              Math.min(prev + 1, Math.max(sourceItems.length - 1, 0))
            );
            return;
          case "ArrowUp":
            event.preventDefault();
            setSubmenuSelectedIndex((prev) => Math.max(prev - 1, 0));
            return;
          case "ArrowLeft":
            event.preventDefault();
            setSubmenuOpen(false);
            return;
          case "Enter":
            event.preventDefault();
            selectSubmenuSource(effectiveSubmenuSelectedIndex);
            return;
          default:
            return;
        }
      }

      if (event.key === "ArrowRight" || event.key === "Tab") {
        const selectedItem = filteredItems[keyboard.selectedIndex];
        if (
          selectedItem &&
          !isHeaderItem(selectedItem) &&
          itemUsesSourceSubmenu(selectedItem)
        ) {
          event.preventDefault();
          const selectedElement = panelRef.current?.querySelector<HTMLElement>(
            `[data-dropdown-item-index="${keyboard.selectedIndex}"]`
          );
          openSourcesForItem(
            selectedItem,
            selectedElement?.getBoundingClientRect().top
          );
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [
    isOpen,
    effectiveSubmenuOpen,
    effectiveSubmenuSelectedIndex,
    sourceItems.length,
    filteredItems,
    keyboard.selectedIndex,
    openSourcesForItem,
    itemUsesSourceSubmenu,
    onClose,
    panelRef,
    selectSubmenuSource,
  ]);

  const placeholder = tCommon("filters.searchModel");

  if (!isOpen || !isPositioned) return null;

  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      panelPosition.left,
      window.innerWidth - VIEWPORT_MARGIN - DROPDOWN_WIDTH
    )
  );
  const rightSubmenuLeft = left + DROPDOWN_WIDTH + SUBMENU_GAP;
  const leftSubmenuLeft = left - SUBMENU_GAP - SUBMENU_WIDTH;
  const canOpenSubmenuRight =
    rightSubmenuLeft + SUBMENU_WIDTH <= window.innerWidth - VIEWPORT_MARGIN;
  const canOpenSubmenuLeft = leftSubmenuLeft >= VIEWPORT_MARGIN;
  const rightAvailableWidth =
    window.innerWidth - rightSubmenuLeft - VIEWPORT_MARGIN;
  const leftAvailableWidth = left - SUBMENU_GAP - VIEWPORT_MARGIN;
  const submenuSide: SubmenuSide =
    canOpenSubmenuRight ||
    (!canOpenSubmenuLeft && rightAvailableWidth >= leftAvailableWidth)
      ? "right"
      : "left";
  const submenuLeft = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      submenuSide === "right" ? rightSubmenuLeft : leftSubmenuLeft,
      window.innerWidth - VIEWPORT_MARGIN - SUBMENU_WIDTH
    )
  );
  const submenuEstimatedHeight = Math.min(
    LIST_MAX_HEIGHT + 8,
    sourceItems.length * 34 + 8
  );
  const fallbackSubmenuTop = panelPosition.top ?? VIEWPORT_MARGIN;
  const preferredSubmenuTop =
    (submenuAnchorTop ?? fallbackSubmenuTop) - SUBMENU_VERTICAL_OFFSET;
  const submenuTop = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      preferredSubmenuTop,
      window.innerHeight - VIEWPORT_MARGIN - submenuEstimatedHeight
    )
  );

  return createPortal(
    <>
      <div
        ref={panelRef}
        className={`${DROPDOWN_CLASSES.panel} fixed flex flex-col`}
        style={{
          top: panelPosition.top,
          bottom: panelPosition.bottom,
          left,
          width: DROPDOWN_WIDTH,
        }}
      >
        <div className={DROPDOWN_CLASSES.searchContainer}>
          <Search size={14} className="shrink-0 text-text-3" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={tauriSelectAll}
            placeholder={placeholder}
            className={DROPDOWN_CLASSES.searchInput}
          />
        </div>

        <div
          className="scrollbar-overlay flex flex-col overflow-y-auto p-1"
          style={{ maxHeight: LIST_MAX_HEIGHT }}
        >
          {filteredItems.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-text-3">
              {tCommon("selectors.modelSelector.noResults")}
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const rowKeyboardProps = isHeaderItem(item)
                ? undefined
                : keyboard.getItemProps(index);
              const rowUsesSubmenu = itemUsesSourceSubmenu(item);
              return (
                <DropdownRow
                  key={item.id}
                  item={item}
                  keyboardProps={rowKeyboardProps}
                  onRowMouseEnter={(event) => {
                    if (rowUsesSubmenu) {
                      openSourcesForItem(
                        item,
                        event.currentTarget.getBoundingClientRect().top
                      );
                    }
                  }}
                  submenuSide={rowUsesSubmenu ? submenuSide : undefined}
                />
              );
            })
          )}
        </div>
      </div>

      {effectiveSubmenuOpen && (
        <div
          className={`${DROPDOWN_CLASSES.panel} fixed flex flex-col p-1`}
          style={{
            top: submenuTop,
            left: submenuLeft,
            width: SUBMENU_WIDTH,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div
            className="scrollbar-overlay flex flex-col overflow-y-auto"
            style={{ maxHeight: LIST_MAX_HEIGHT }}
          >
            {sourceItems.map((item, index) => (
              <DropdownRow
                key={item.id}
                item={item}
                keyboardProps={{
                  "data-dropdown-item-index": index,
                  "data-dropdown-keyboard-highlight":
                    effectiveSubmenuSelectedIndex === index
                      ? "true"
                      : undefined,
                  "aria-selected": effectiveSubmenuSelectedIndex === index,
                  onMouseEnter: () => setSubmenuSelectedIndex(index),
                  onClick: () => selectSubmenuSource(index),
                }}
              />
            ))}
          </div>
        </div>
      )}
    </>,
    document.body
  );
};

UnifiedModelDropdown.displayName = "UnifiedModelDropdown";
