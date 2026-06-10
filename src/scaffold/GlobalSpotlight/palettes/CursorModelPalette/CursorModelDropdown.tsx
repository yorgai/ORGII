/**
 * CursorModelDropdown
 *
 * Anchored compact variant of CursorModelPalette for chat-input model pills.
 * Shares the same input data as the Spotlight palette, but renders as the
 * workspace / branch style menu when the user selects dropdown pickers.
 */
import { Check, RefreshCw, Search } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type {
  CursorModelEntry,
  CursorModelSource,
} from "@src/api/tauri/cursorBridge";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import ModelIcon from "@src/components/ModelIcon";
import {
  type UseDropdownListNavigationReturn,
  useDropdownEngine,
} from "@src/hooks/dropdown";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import { useFilteredItems } from "@src/hooks/search";
import {
  compactModelLabel,
  formatModelNameFull,
} from "@src/util/formatModelName";
import { getViewportSize } from "@src/util/ui/window/viewport";

const DROPDOWN_WIDTH = 320;
const LIST_MAX_HEIGHT = 280;
const VIEWPORT_MARGIN = 12;

function modelLabelOf(model: CursorModelEntry): string {
  return (
    model.inputboxShortName ||
    model.clientDisplayName ||
    compactModelLabel(formatModelNameFull(model.name))
  );
}

interface CursorModelDropdownRowProps {
  model: CursorModelEntry;
  isCurrent: boolean;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

const CursorModelDropdownRow: React.FC<CursorModelDropdownRowProps> = ({
  model,
  isCurrent,
  keyboardProps,
}) => {
  const label = modelLabelOf(model);
  return (
    <button
      type="button"
      data-testid={`cursor-model-dropdown-row-${model.name}`}
      {...keyboardProps}
      className={`${DROPDOWN_CLASSES.item} ${
        isCurrent ? DROPDOWN_CLASSES.itemSelected : DROPDOWN_CLASSES.itemHover
      } w-full justify-start`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {isCurrent ? (
          <Check
            size={DROPDOWN_ITEM.iconSize}
            strokeWidth={2.25}
            className="text-primary-6"
          />
        ) : (
          <ModelIcon modelName={model.name} size={DROPDOWN_ITEM.iconSize} />
        )}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-left ${isCurrent ? "text-primary-6" : ""}`}
      >
        {label}
      </span>
    </button>
  );
};

export interface CursorModelDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  models: CursorModelEntry[];
  modelSource: CursorModelSource;
  effectiveModel: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  onSelect: (modelName: string) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  placement?: "bottom" | "top";
}

export const CursorModelDropdown: React.FC<CursorModelDropdownProps> = ({
  isOpen,
  onClose,
  models,
  modelSource,
  effectiveModel,
  loading,
  error,
  refresh,
  onSelect,
  anchorRef,
  placement = "bottom",
}) => {
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const tauriSelectAll = useTauriSelectAllShortcut();

  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (isOpen && models.length === 0 && !loading && !error) {
      void refresh();
    }
  }, [isOpen, models.length, loading, error, refresh]);

  const vendorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of models) {
      if (model.vendor) map.set(model.name, model.vendor);
    }
    return map;
  }, [models]);

  const { filteredItems } = useFilteredItems({
    items: models,
    searchQuery,
    getSearchText: (model) => {
      const label = modelLabelOf(model);
      const vendor = vendorByName.get(model.name) ?? "";
      return `${label} ${model.name} ${vendor}`.trim();
    },
  });

  const handleSelect = useCallback(
    (modelName: string) => {
      onSelect(modelName);
      onClose();
    },
    [onSelect, onClose]
  );

  const { isPositioned, panelRef, panelPosition, keyboard } = useDropdownEngine<
    HTMLElement,
    CursorModelEntry
  >({
    open: isOpen,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    anchorRef,
    placement,
    gap: DROPDOWN_PANEL.triggerGap,
    listNavigation: {
      items: filteredItems,
      onSelect: (model) => handleSelect(model.name),
      initialSelectedIndex: -1,
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      setSearchQuery("");
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const placeholder = tCommon("filters.searchModelFor", { target: "Cursor" });
  const emptyText = loading
    ? t("chat.cursorControl.modelLoading")
    : error
      ? t("chat.cursorControl.modelLoadError")
      : t("chat.cursorControl.modelEmpty");

  if (!isOpen || !isPositioned) return null;

  const { width: vw } = getViewportSize();
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(panelPosition.left, vw - VIEWPORT_MARGIN - DROPDOWN_WIDTH)
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
        <Search
          size={DROPDOWN_ITEM.iconSize}
          className="shrink-0 text-text-3"
        />
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
        className={DROPDOWN_CLASSES.optionsContainerOverlay}
        style={{ maxHeight: LIST_MAX_HEIGHT }}
      >
        {filteredItems.length === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>{emptyText}</div>
        ) : (
          filteredItems.map((model, index) => (
            <CursorModelDropdownRow
              key={model.name}
              model={model}
              isCurrent={model.name === effectiveModel}
              keyboardProps={keyboard.getItemProps(index)}
            />
          ))
        )}
      </div>

      <div className={DROPDOWN_CLASSES.footerContainer}>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-start disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <RefreshCw
            size={DROPDOWN_ITEM.iconSize}
            className={`shrink-0 text-text-2 ${loading ? "animate-spin" : ""}`}
          />
          <span className="truncate">{t("chat.cursorControl.modelRetry")}</span>
          {modelSource === "disk" && (
            <span className="ml-auto shrink-0 truncate text-[11px] text-text-3">
              {t("chat.cursorControl.modelSourceDisk")}
            </span>
          )}
        </button>
      </div>
    </div>,
    document.body
  );
};

CursorModelDropdown.displayName = "CursorModelDropdown";
