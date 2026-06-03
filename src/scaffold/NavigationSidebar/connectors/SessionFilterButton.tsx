import {
  CheckCheck,
  FolderInput,
  FolderOutput,
  ListChevronsDownUp,
  ListFilter,
  RefreshCw,
} from "lucide-react";
import React, { type FC, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import LiquidGlassHoverItem from "@src/components/LiquidGlassHoverItem";
import { useDropdownEngine } from "@src/hooks/dropdown";

import HoverAnimatedIcon, {
  triggerIconAnimation,
} from "../components/HoverAnimatedIcon";
import { GROUP_BY_MODES } from "./types";

interface SessionFilterButtonProps {
  groupByMode: string;
  groupByModes?: readonly string[];
  getGroupByLabel?: (mode: string) => string;
  onSelect: (mode: string) => void;
  /** Collapse every section in the sidebar. */
  onCollapseAll?: () => void;
  /** Mark all currently-loaded sessions as visited. */
  onMarkAllRead?: () => void;
  /** Refresh the sidebar session list from the backing stores. */
  onRefreshSessions?: () => void;
  /** Open the JSON Session export modal for the active Session. */
  onExportSessionJson?: () => void;
  /** Open the JSON Session import modal. */
  onImportSessionJson?: () => void;
  canExportSessionJson?: boolean;
}

export const SessionFilterButton: FC<SessionFilterButtonProps> = React.memo(
  ({
    groupByMode,
    groupByModes = GROUP_BY_MODES,
    getGroupByLabel,
    onSelect,
    onCollapseAll,
    onMarkAllRead,
    onRefreshSessions,
    onExportSessionJson,
    onImportSessionJson,
    canExportSessionJson = true,
  }) => {
    const { t } = useTranslation("navigation");
    const { t: tCommon } = useTranslation("common");
    const {
      isOpen,
      isPositioned,
      toggle,
      close,
      triggerRef,
      panelRef,
      panelPosition,
    } = useDropdownEngine<HTMLDivElement>({
      placement: "top",
      align: "left",
      gap: DROPDOWN_PANEL.triggerGap,
    });

    const handleSelect = useCallback(
      (mode: string) => {
        onSelect(mode);
        close();
      },
      [onSelect, close]
    );

    const handleCollapseAll = useCallback(() => {
      onCollapseAll?.();
      close();
    }, [onCollapseAll, close]);

    const handleMarkAllRead = useCallback(() => {
      onMarkAllRead?.();
      close();
    }, [onMarkAllRead, close]);

    const handleRefreshSessions = useCallback(() => {
      onRefreshSessions?.();
      close();
    }, [onRefreshSessions, close]);

    const handleExportSessionJson = useCallback(() => {
      onExportSessionJson?.();
      close();
    }, [onExportSessionJson, close]);

    const handleImportSessionJson = useCallback(() => {
      onImportSessionJson?.();
      close();
    }, [onImportSessionJson, close]);

    const hasExtraActions = Boolean(
      onCollapseAll ||
      onMarkAllRead ||
      onRefreshSessions ||
      onExportSessionJson ||
      onImportSessionJson
    );

    return (
      <>
        <div ref={triggerRef} title={t("sidebar.groupBy.title")}>
          <LiquidGlassHoverItem
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px]"
            onClick={toggle}
            onMouseEnter={(event) => triggerIconAnimation(event.currentTarget)}
          >
            <HoverAnimatedIcon
              icon={ListFilter}
              iconName="list-filter"
              size={16}
              strokeWidth={2}
              className={isOpen ? "text-primary-6" : "text-text-2"}
            />
          </LiquidGlassHoverItem>
        </div>

        {isOpen &&
          isPositioned &&
          createPortal(
            <div
              ref={panelRef}
              className={`${DROPDOWN_CLASSES.panelAnimated} ${DROPDOWN_WIDTHS.sidebarMenuClass} fixed`}
              style={{
                top: panelPosition.top,
                bottom: panelPosition.bottom,
                left: panelPosition.left,
              }}
            >
              <div className={DROPDOWN_CLASSES.sectionLabel}>
                {t("sidebar.groupBy.title")}
              </div>
              <div className={DROPDOWN_CLASSES.itemsColumnBelowHeader}>
                {groupByModes.map((mode) => {
                  const active = mode === groupByMode;
                  const itemClasses = active
                    ? `${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemSelected}`
                    : `${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover}`;
                  return (
                    <button
                      key={mode}
                      type="button"
                      className={`${itemClasses} w-full justify-between text-left`}
                      onClick={() => handleSelect(mode)}
                    >
                      <span>
                        {getGroupByLabel?.(mode) ??
                          t(`sidebar.groupBy.${mode}`)}
                      </span>
                      {active && <DropdownSelectedCheck />}
                    </button>
                  );
                })}
              </div>
              {hasExtraActions && (
                <>
                  <div className={DROPDOWN_CLASSES.menuSeparator} />
                  <div className={DROPDOWN_CLASSES.itemsColumnBelowHeader}>
                    {onRefreshSessions && (
                      <button
                        type="button"
                        className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-start gap-2 text-left`}
                        onClick={handleRefreshSessions}
                      >
                        <RefreshCw
                          size={DROPDOWN_ITEM.iconSize}
                          strokeWidth={2}
                          className="shrink-0 text-text-2"
                        />
                        <span>{tCommon("actions.refresh")}</span>
                      </button>
                    )}
                    {onExportSessionJson && (
                      <button
                        type="button"
                        className={`${DROPDOWN_CLASSES.item} ${canExportSessionJson ? DROPDOWN_CLASSES.itemHover : "cursor-not-allowed opacity-50"} w-full justify-start gap-2 text-left`}
                        onClick={handleExportSessionJson}
                        disabled={!canExportSessionJson}
                      >
                        <FolderOutput
                          size={DROPDOWN_ITEM.iconSize}
                          strokeWidth={2}
                          className="shrink-0 text-text-2"
                        />
                        <span>
                          {tCommon("sessions:chat.importExport.exportAction")}
                        </span>
                      </button>
                    )}
                    {onImportSessionJson && (
                      <button
                        type="button"
                        className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-start gap-2 text-left`}
                        onClick={handleImportSessionJson}
                      >
                        <FolderInput
                          size={DROPDOWN_ITEM.iconSize}
                          strokeWidth={2}
                          className="shrink-0 text-text-2"
                        />
                        <span>
                          {tCommon("sessions:chat.importExport.importAction")}
                        </span>
                      </button>
                    )}
                    {onCollapseAll && (
                      <button
                        type="button"
                        className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-start gap-2 text-left`}
                        onClick={handleCollapseAll}
                      >
                        <ListChevronsDownUp
                          size={DROPDOWN_ITEM.iconSize}
                          strokeWidth={2}
                          className="shrink-0 text-text-2"
                        />
                        <span>{t("sidebar.actions.collapseAll")}</span>
                      </button>
                    )}
                    {onMarkAllRead && (
                      <button
                        type="button"
                        className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-start gap-2 text-left`}
                        onClick={handleMarkAllRead}
                      >
                        <CheckCheck
                          size={DROPDOWN_ITEM.iconSize}
                          strokeWidth={2}
                          className="shrink-0 text-text-2"
                        />
                        <span>{t("sidebar.actions.markAllRead")}</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>,
            document.body
          )}
      </>
    );
  }
);

SessionFilterButton.displayName = "SessionFilterButton";
