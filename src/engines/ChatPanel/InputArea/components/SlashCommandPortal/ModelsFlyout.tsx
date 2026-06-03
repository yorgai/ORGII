/**
 * ModelsFlyout — right-side model picker flyout.
 *
 * Renders the same content as UnifiedModelDropdown but positioned like
 * FlyoutSubmenu: fixed beside the main panel, not below an anchor
 * element. Directly embeds useUnifiedModelPalette so we control the position.
 */
import { ChevronLeft, Search } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import { useFilteredItems } from "@src/hooks/search";
import { useUnifiedModelPalette } from "@src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/useUnifiedModelPalette";
import type { SpotlightItem } from "@src/scaffold/GlobalSpotlight/shared";

const DROPDOWN_WIDTH = 320;
const LIST_MAX_HEIGHT = 280;
const VIEWPORT_MARGIN = 12;

// ── Internal row renderer (mirrors UnifiedModelDropdown) ──────────────────────

function getItemData(item: SpotlightItem): Record<string, unknown> {
  return (item.data as Record<string, unknown> | undefined) ?? {};
}

function isHeaderItem(item: SpotlightItem): boolean {
  return getItemData(item).isHeader === true;
}

interface DropdownRowProps {
  item: SpotlightItem;
  onSelect: (item: SpotlightItem) => void;
}

const DropdownRow: React.FC<DropdownRowProps> = ({ item, onSelect }) => {
  const renderedIcon = useMemo(() => {
    if (!item.icon) return null;
    if (typeof item.icon === "string") {
      return <i className={`${item.icon} text-[16px] text-text-2`} />;
    }
    return React.createElement(item.icon, { size: 16 });
  }, [item.icon]);

  const data = getItemData(item);

  if (isHeaderItem(item)) {
    return <div className={DROPDOWN_CLASSES.sectionLabel}>{item.label}</div>;
  }

  const labelContent = data.labelContent as React.ReactNode | undefined;
  const rightContent = data.rightContent as React.ReactNode | undefined;
  const rightLabel = data.rightLabel as string | undefined;
  const testId = typeof data.testId === "string" ? data.testId : undefined;

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => onSelect(item)}
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

DropdownRow.displayName = "DropdownRow";

// ── ModelsFlyout ──────────────────────────────────────────────────────────────

interface ModelsFlyoutProps {
  anchorTop: number;
  panelRight: number;
  advancedConfig: AdvancedConfig;
  onConfigChange: (config: AdvancedConfig) => void;
  onClose: () => void;
}

const ModelsFlyout: React.FC<ModelsFlyoutProps> = ({
  anchorTop,
  panelRight,
  advancedConfig,
  onConfigChange,
  onClose,
}) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tauriSelectAll = useTauriSelectAllShortcut();
  const [searchQuery, setSearchQuery] = useState("");

  const {
    activeColumn,
    rawItems,
    sourceItems,
    handleBack: handleBackInternal,
    tCommon,
  } = useUnifiedModelPalette({
    isOpen: true,
    onClose,
    advancedConfig,
    onConfigChange,
  });

  const step = activeColumn;
  const visibleItems = step === "sources" ? sourceItems : rawItems;

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

  // Focus search input on mount / step change
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // Click outside → close
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    };
    // Delay so the mousedown that opened the flyout doesn't immediately close it
    const id = setTimeout(
      () => document.addEventListener("mousedown", handler),
      0
    );
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Escape: step back or close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (step === "sources") {
        handleBack();
      } else {
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [step, handleBack, onClose]);

  const handleSelect = useCallback((item: SpotlightItem) => {
    if (isHeaderItem(item)) return;
    item.action?.();
  }, []);

  const placeholder =
    step === "models"
      ? tCommon("filters.searchModel")
      : tCommon("filters.searchModelSource");

  // Clamp left so the panel doesn't overflow the right edge of the viewport
  const left = Math.min(
    panelRight + DROPDOWN_PANEL.submenuGap,
    window.innerWidth - DROPDOWN_WIDTH - VIEWPORT_MARGIN
  );

  return createPortal(
    <div
      ref={panelRef}
      className={`${DROPDOWN_CLASSES.panel} fixed flex flex-col`}
      style={{
        top: anchorTop,
        left,
        width: DROPDOWN_WIDTH,
        zIndex: 99999,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className={DROPDOWN_CLASSES.searchContainer}>
        {step === "sources" && (
          <button
            type="button"
            onClick={handleBack}
            aria-label={t("actions.back")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-2 hover:bg-fill-2 hover:text-text-1"
          >
            <ChevronLeft size={DROPDOWN_ITEM.iconSize} />
          </button>
        )}
        <Search
          size={DROPDOWN_ITEM.iconSize}
          className="shrink-0 text-text-3"
        />
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={tauriSelectAll}
          placeholder={placeholder}
          className={DROPDOWN_CLASSES.searchInput}
        />
      </div>

      <div
        className={DROPDOWN_CLASSES.optionsContainerOverlay}
        style={{ maxHeight: LIST_MAX_HEIGHT }}
      >
        {filteredItems.length === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>
            {tCommon("selectors.modelSelector.noResults")}
          </div>
        ) : (
          filteredItems.map((item) => (
            <DropdownRow key={item.id} item={item} onSelect={handleSelect} />
          ))
        )}
      </div>
    </div>,
    document.body
  );
};

ModelsFlyout.displayName = "ModelsFlyout";

export default ModelsFlyout;
