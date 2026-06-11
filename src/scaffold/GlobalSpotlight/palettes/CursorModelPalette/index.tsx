/**
 * CursorModelPalette
 *
 * Spotlight palette for picking a Cursor IDE model. Used by both the
 * SessionCreator pill (`CursorModelPillCreator`) and the focused
 * Cursor IDE session pill (`CursorModelPill`) so the picker UX
 * matches every other model selector in the app.
 *
 * The palette is a thin presentational shell: it accepts the model
 * list / loading / error state from `useCursorModels` (rendered by
 * the caller) and emits `onSelect(modelName)` when the user picks.
 * Refresh is wired as a footer action so a stale list can be
 * re-fetched without closing the palette.
 *
 * Cursor's models are an entirely separate universe from ORGII's
 * provider/listing model space (the user's Cursor entitlement is
 * what gates them), so this palette deliberately does NOT reuse
 * `UnifiedModelPalette` — it has no source segment, no recents tab,
 * and no key-vault footer.
 */
import { RefreshCw } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  CursorModelEntry,
  CursorModelSource,
} from "@src/api/tauri/cursorBridge";
import ModelIcon from "@src/components/ModelIcon";
import { useFilteredItems } from "@src/hooks/search";
import {
  compactModelLabel,
  formatModelNameFull,
} from "@src/util/formatModelName";

import {
  SPOTLIGHT_FOOTER_ACTIVE_CHIP,
  SpotlightPinnedActionSection,
} from "../../components";
import { usePathSegment } from "../../hooks";
import type { BasePaletteProps } from "../../shared";
import { PaletteBody, SpotlightShell } from "../../shell";
import type { SpotlightItem } from "../../types";
import { CURSOR_MODEL_PALETTE_CONFIG } from "../config";
import { useSelectorKernel } from "../core";

/** Target name surfaced in the search bar ("Select a model for Cursor..."). */
const CURSOR_TARGET = "Cursor";

export interface CursorModelPaletteProps extends BasePaletteProps {
  models: CursorModelEntry[];
  modelSource: CursorModelSource;
  /** Currently active model (picked > seed) — drives the checkmark. */
  effectiveModel: string | null;
  /** True while `listModels()` is in flight. */
  loading: boolean;
  error: string | null;
  /** Force a fresh `listModels()` round-trip. */
  refresh: () => Promise<void>;
  /** Stash the user's pick. */
  onSelect: (modelName: string) => void;
}

/**
 * Cursor's UI uses `inputboxShortName` on the chat input and
 * `clientDisplayName` on the picker — we prefer the short one for
 * search match priority. When neither is present (rare — Cursor
 * normally hands us pretty labels) we run the canonical id through
 * the same `formatModelNameFull` + `compactModelLabel` pipeline as
 * the regular ModelPill so the cosmetics match ("Opus 4.5" instead
 * of "claude-opus-4-6").
 */
function modelLabelOf(model: CursorModelEntry): string {
  return (
    model.inputboxShortName ||
    model.clientDisplayName ||
    compactModelLabel(formatModelNameFull(model.name))
  );
}

export const CursorModelPalette: React.FC<CursorModelPaletteProps> = ({
  isOpen,
  onClose,
  onGoBackToParent,
  models,
  modelSource,
  effectiveModel,
  loading,
  error,
  refresh,
  onSelect,
}) => {
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");

  // Auto-fetch the first time the palette opens with no list. The
  // caller's `useCursorModels` already lazily fetches on mount —
  // this just covers the path where the palette opens before the
  // caller had a chance to.
  useEffect(() => {
    if (isOpen && models.length === 0 && !loading && !error) {
      void refresh();
    }
  }, [isOpen, models.length, loading, error, refresh]);

  // Build a side-table of vendor strings keyed by item id so the
  // search predicate can still match on "openai" / "anthropic"
  // without rendering vendor as a visible second line.
  const vendorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of models) {
      if (model.vendor) {
        map.set(model.name, model.vendor);
      }
    }
    return map;
  }, [models]);

  const items = useMemo<SpotlightItem[]>(() => {
    return models.map((model) => {
      const label = modelLabelOf(model);
      const isCurrent = effectiveModel === model.name;
      return {
        id: model.name,
        label,
        // Single-line rows — vendor lives in `vendorById` for
        // search matching only, never rendered as a sub-line.
        desc: "",
        type: "action" as const,
        icon: () => <ModelIcon modelName={model.name} size={16} />,
        data: {
          isSelector: true,
          isCurrentSelection: isCurrent,
        },
        action: () => {
          onSelect(model.name);
          onClose();
        },
      };
    });
  }, [models, effectiveModel, onSelect, onClose]);

  const refreshActionItems = useMemo<SpotlightItem[]>(() => {
    const refreshLabel = t("chat.cursorControl.modelRetry");
    return [
      {
        id: "pinned-cursor-model-refresh",
        label: refreshLabel,
        icon: RefreshCw,
        type: "action",
        data: {
          disabled: loading,
          inlineTag:
            modelSource === "disk"
              ? t("chat.cursorControl.modelSourceDisk")
              : undefined,
        },
        action: () => {
          void refresh();
        },
      },
    ];
  }, [t, loading, modelSource, refresh]);

  const [searchQuery, setSearchQuery] = useState("");
  const { filteredItems } = useFilteredItems({
    items,
    searchQuery,
    getSearchText: (item) => {
      const vendor = vendorById.get(item.id) ?? "";
      return `${item.label} ${vendor}`.trim();
    },
  });

  const pinnedActionStartIndex = filteredItems.length;
  const navigableItems = useMemo(
    () => [...filteredItems, ...refreshActionItems],
    [filteredItems, refreshActionItems]
  );

  const isItemSelectable = useCallback((item: SpotlightItem) => {
    const data = item.data as Record<string, unknown> | undefined;
    return !data?.isHeader && !data?.disabled;
  }, []);

  const handleSectionTab = useCallback(
    (
      forward: boolean,
      selectedIndex: number,
      setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
    ) => {
      if (refreshActionItems.length === 0) return;

      const firstMainItemIndex = filteredItems.findIndex(isItemSelectable);
      const firstPinnedItemIndex = pinnedActionStartIndex;
      const selectedPinnedActionIndex = selectedIndex - pinnedActionStartIndex;
      const selectedWithinPinnedActions =
        selectedPinnedActionIndex >= 0 &&
        selectedPinnedActionIndex < refreshActionItems.length;
      const nextIndex = forward
        ? selectedWithinPinnedActions
          ? firstMainItemIndex >= 0
            ? firstMainItemIndex
            : firstPinnedItemIndex
          : firstPinnedItemIndex
        : selectedWithinPinnedActions
          ? firstMainItemIndex >= 0
            ? firstMainItemIndex
            : firstPinnedItemIndex
          : firstPinnedItemIndex;

      setSelectedIndex(nextIndex);
    },
    [
      filteredItems,
      isItemSelectable,
      pinnedActionStartIndex,
      refreshActionItems.length,
    ]
  );

  const handleExternalKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement>,
      internalHandleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
    ) => {
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        searchQuery === "" &&
        onGoBackToParent
      ) {
        event.preventDefault();
        onGoBackToParent();
        return;
      }
      internalHandleKeyDown(event);
    },
    [searchQuery, onGoBackToParent]
  );

  const kernel = useSelectorKernel({
    isOpen,
    onClose,
    items: navigableItems,
    isItemSelectable,
    onTab: handleSectionTab,
    externalSearchQuery: searchQuery,
    externalSetSearchQuery: setSearchQuery,
    externalHandleKeyDown: onGoBackToParent ? handleExternalKeyDown : undefined,
  });

  // Mirror the UnifiedModelPalette wording so every model picker in
  // the app reads the same sentence — "Select a model for Cursor..."
  // — instead of a Cursor-specific phrasing.
  const path = usePathSegment(CURSOR_MODEL_PALETTE_CONFIG.path, {
    labelOverride: tCommon("filters.model"),
    templateOverride: tCommon("filters.tplSelectModelFor", {
      target: CURSOR_TARGET,
    }),
  });

  // Empty / error / loading states render via the placeholder slot
  // so the row UI doesn't show a misleading "no results" header
  // when the actual problem is a fetch failure.
  const placeholder = useMemo(() => {
    if (filteredItems.length > 0) {
      return tCommon("filters.searchModelFor", { target: CURSOR_TARGET });
    }
    if (loading) {
      return t("chat.cursorControl.modelLoading");
    }
    if (error) {
      return t("chat.cursorControl.modelLoadError");
    }
    return t("chat.cursorControl.modelEmpty");
  }, [filteredItems.length, loading, error, t, tCommon]);

  return (
    <SpotlightShell
      isOpen={isOpen}
      onClose={onClose}
      hasActiveAction={refreshActionItems.length > 0}
      activeActionChip={SPOTLIGHT_FOOTER_ACTIVE_CHIP.switchSection}
    >
      <PaletteBody
        kernel={kernel}
        items={filteredItems}
        path={path}
        onRemoveSegment={onGoBackToParent ?? onClose}
        placeholder={placeholder}
        containerHeight={Math.min(120 + items.length * 40, 380)}
        isLoading={loading}
        afterListSlot={
          <SpotlightPinnedActionSection
            items={refreshActionItems}
            startIndex={pinnedActionStartIndex}
            selectedIndex={kernel.selectedIndex}
            onItemSelect={kernel.handleItemClick}
            onItemHover={kernel.setSelectedIndex}
            searchQuery={kernel.searchQuery}
          />
        }
      />
    </SpotlightShell>
  );
};
