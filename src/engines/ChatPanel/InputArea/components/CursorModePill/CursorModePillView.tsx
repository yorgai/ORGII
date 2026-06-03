/**
 * CursorModePillView
 *
 * Presentational pill for the Cursor IDE unified-mode picker. The
 * trigger keeps PillGroup parity with `CursorModelPillView`, but the
 * picker itself is the same compact `useDropdownEngine` + `DropdownPanel`
 * + `DropdownItem` stack that the regular `ModePill` uses — no global
 * Spotlight palette. Refresh and the "modes came from bundled fallback"
 * hint live inside the dropdown footer.
 *
 * State (picked mode, mode list fetching) is owned by the wrapper that
 * mounts this view — both the in-session pill (`./index.tsx`) and the
 * SessionCreator pill (`./CursorModePillCreator.tsx`) feed it through
 * `useCursorModes` and a wrapper-specific override-storage hook.
 */
import { Grip, RefreshCw } from "lucide-react";
import React, { useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type {
  CursorModeEntry,
  CursorModeSource,
} from "@src/api/tauri/cursorBridge";
import { getIconSize } from "@src/components/CompoundPill/config";
import {
  DropdownFooter,
  DropdownItem,
  DropdownPanel,
} from "@src/components/Dropdown/exports";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import PillGroup, { type PillGroupSegment } from "@src/components/PillGroup";
import Tooltip from "@src/components/Tooltip";
import { useDropdownEngine } from "@src/hooks/dropdown";

import { getModeIcon } from "./modeIcons";

interface CursorModePillViewProps {
  /** Picked → seed → null. The label / icon driver. */
  effectiveMode: string | null;
  modes: CursorModeEntry[];
  modeSource: CursorModeSource;
  loading: boolean;
  /** Force a fresh `listModes()` round-trip. */
  refresh: () => Promise<void>;
  /** Stash the user's pick. */
  selectMode: (modeId: string) => void;
}

const CursorModePillView: React.FC<CursorModePillViewProps> = ({
  effectiveMode,
  modes,
  modeSource,
  loading,
  refresh,
  selectMode,
}) => {
  const { t } = useTranslation("sessions");
  const iconSize = getIconSize();

  const {
    isOpen,
    isPositioned,
    toggle,
    close,
    triggerRef,
    panelRef,
    panelPosition,
  } = useDropdownEngine<HTMLDivElement>({
    gap: 6,
    align: "left",
    placement: "top",
  });

  const handleSelect = useCallback(
    (modeId: string) => {
      selectMode(modeId);
      close();
    },
    [selectMode, close]
  );

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  // Resolve the displayed label. Priority: live entry's `name`
  // (Cursor's own picker label, e.g. "Plan", "Ask") → capitalized
  // canonical id when the list hasn't loaded yet → "…" while the
  // seed is still resolving. Same shape as the model pill so the
  // two pills feel cosmetically identical at rest.
  const entry = effectiveMode
    ? modes.find((mode) => mode.id === effectiveMode)
    : undefined;
  const displayLabel = !effectiveMode
    ? "…"
    : (entry?.name ??
      effectiveMode.charAt(0).toUpperCase() + effectiveMode.slice(1));

  const switchTooltip = t("creator.switchMode", {
    defaultValue: "Switch mode",
  });

  const iconNode = effectiveMode ? (
    React.createElement(getModeIcon(effectiveMode), {
      size: iconSize,
      strokeWidth: 1.75,
      className: "text-text-1",
    })
  ) : (
    <Grip size={iconSize} strokeWidth={1.75} className="text-text-1" />
  );

  const segments: PillGroupSegment[] = [
    {
      id: "cursor-mode",
      icon: iconNode,
      label: displayLabel,
      title:
        modeSource === "bundled"
          ? t("chat.cursorControl.modeSourceBundled", {
              defaultValue:
                "Modes loaded from bundled fallback (probe Cursor not yet running).",
            })
          : displayLabel,
      tooltip: switchTooltip,
      ariaLabel: switchTooltip,
      active: isOpen,
      maxLabelWidth: 140,
      onClick: toggle,
    },
  ];

  const refreshLabel = t("chat.cursorControl.modeRefresh");
  const refreshTooltip =
    modeSource === "bundled"
      ? t("chat.cursorControl.modeSourceBundled")
      : refreshLabel;

  return (
    <div ref={triggerRef}>
      <PillGroup
        segments={segments}
        className="text-[13px]"
        segmentClassName="h-[28px]"
        variant="input"
      />

      {isOpen &&
        isPositioned &&
        createPortal(
          <DropdownPanel
            ref={panelRef}
            className={`fixed ${DROPDOWN_WIDTHS.menuClass}`}
            style={{
              ...(panelPosition.top !== undefined
                ? { top: panelPosition.top }
                : { bottom: panelPosition.bottom }),
              left: panelPosition.left,
            }}
          >
            <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
              {modes.map((option) => {
                const Icon = getModeIcon(option.id);
                const isSelected = effectiveMode === option.id;
                return (
                  <DropdownItem
                    key={option.id}
                    icon={
                      <Icon size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
                    }
                    selected={isSelected}
                    showCheckmark
                    onClick={() => handleSelect(option.id)}
                  >
                    {option.name}
                  </DropdownItem>
                );
              })}
            </div>
            <DropdownFooter className="justify-end">
              <Tooltip content={refreshTooltip} position="top">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={loading}
                  aria-label={refreshLabel}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw
                    size={13}
                    strokeWidth={1.75}
                    className={loading ? "animate-spin" : undefined}
                  />
                </button>
              </Tooltip>
            </DropdownFooter>
          </DropdownPanel>,
          document.body
        )}
    </div>
  );
};

export default CursorModePillView;
