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
import { ChevronLeft, Search } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

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
import { useUnifiedModelPalette } from "./useUnifiedModelPalette";

const DROPDOWN_WIDTH = 320;
const LIST_MAX_HEIGHT = 280;
const VIEWPORT_MARGIN = 12;

function getItemData(item: SpotlightItem): Record<string, unknown> {
  return (item.data as Record<string, unknown> | undefined) ?? {};
}

function isHeaderItem(item: SpotlightItem): boolean {
  return getItemData(item).isHeader === true;
}

interface DropdownRowProps {
  item: SpotlightItem;
  keyboardProps?: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

const DropdownRow: React.FC<DropdownRowProps> = ({ item, keyboardProps }) => {
  const renderedIcon = useMemo(() => {
    if (!item.icon) return null;
    if (typeof item.icon === "string") {
      return <i className={`${item.icon} text-[16px] text-text-2`} />;
    }
    return React.createElement(item.icon, { size: 16 });
  }, [item.icon]);

  const data = getItemData(item);

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

  return (
    <button
      type="button"
      data-testid={testId}
      {...keyboardProps}
      className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-start`}
    >
      {renderedIcon && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {renderedIcon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px]">
        {labelContent ?? item.label}
      </span>
      {rightContent
        ? rightContent
        : rightLabel && (
            <span className="shrink-0 truncate text-[12px] text-text-3">
              {rightLabel}
            </span>
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
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const tauriSelectAll = useTauriSelectAllShortcut();

  const {
    activeColumn,
    rawItems,
    sourceItems,
    handleBack: handleBackInternal,
    tCommon,
  } = useUnifiedModelPalette({
    isOpen,
    onClose,
    advancedConfig,
    onConfigChange,
    dispatchCategoryOverride,
    cliAgentTypeOverride,
  });

  // The dropdown keeps the classic two-step flow: model list, then the
  // compatible accounts for the chosen model.
  const step = activeColumn;
  const visibleItems = step === "sources" ? sourceItems : rawItems;

  const [searchQuery, setSearchQuery] = React.useState("");

  // Resetting search query is a user-action-driven side effect (back nav),
  // not effect-synced state — keep it bound to the click handler.
  const handleBack = useCallback(() => {
    setSearchQuery("");
    handleBackInternal();
  }, [handleBackInternal]);

  const { filteredItems } = useFilteredItems({
    items: visibleItems,
    searchQuery,
    getSearchText: (item: SpotlightItem) => {
      const data = getItemData(item);
      const rightLabel = (data.rightLabel as string | undefined) ?? "";
      const searchAlias = (data.searchAlias as string | undefined) ?? "";
      return `${item.label} ${item.desc || ""} ${rightLabel} ${searchAlias}`;
    },
  });

  // ── Focus search on open / step change ────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      setSearchQuery("");
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, step]);

  const handleSelect = useCallback((item: SpotlightItem) => {
    if (isHeaderItem(item)) return;
    item.action?.();
  }, []);

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (step === "sources") {
        handleBack();
      } else {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, step, handleBack, onClose]);

  const placeholder =
    step === "models"
      ? tCommon("filters.searchModel")
      : tCommon("filters.searchModelSource");

  if (!isOpen || !isPositioned) return null;

  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      panelPosition.left,
      window.innerWidth - VIEWPORT_MARGIN - DROPDOWN_WIDTH
    )
  );

  return createPortal(
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
        {step === "sources" && (
          <button
            type="button"
            onClick={handleBack}
            aria-label={t("actions.back")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-2 hover:bg-fill-2 hover:text-text-1"
          >
            <ChevronLeft size={14} />
          </button>
        )}
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
          filteredItems.map((item, index) => (
            <DropdownRow
              key={item.id}
              item={item}
              keyboardProps={
                isHeaderItem(item) ? undefined : keyboard.getItemProps(index)
              }
            />
          ))
        )}
      </div>
    </div>,
    document.body
  );
};

UnifiedModelDropdown.displayName = "UnifiedModelDropdown";
