/**
 * SecondaryPanelHeader
 *
 * Shared header chrome for the secondary panel slot (Browser DevTools,
 * Code Editor bottom panel, etc.) used by `WorkStationShell`'s
 * `secondaryPanelConfig`.
 *
 * Behaviour by position (matches the `SecondaryPanelPosition` toggle):
 * - `bottom` → renders pill-style tabs (`TabPill` variant=pill). All
 *   per-tab action buttons sit inline on the same row to the right of
 *   the tabs, exactly like the editor bottom panel.
 * - `right`  → renders editor-style tab rows (`TabBar` chrome). Persistent
 *   controls (position toggle, close) stay on the tab row; per-tab
 *   action buttons drop to a second row underneath so the narrow right
 *   rail isn't cluttered.
 *
 * Tabs and content stay mounted across position toggles — only the
 * chrome flavour swaps. Caller owns the active tab state.
 */
import type { ReactNode } from "react";
import React, { memo, useCallback, useMemo } from "react";

import TabPill from "@src/components/TabPill";
import { TabBar } from "@src/modules/WorkStation/shared/TabBar";
import type { SecondaryPanelPosition } from "@src/store/ui/workStationAtom";
import type { WorkStationTab } from "@src/store/workstation/tabs";

export interface SecondaryPanelHeaderTab {
  key: string;
  label: string;
  /** Optional lucide icon name; only consumed by the TabBar (right) chrome. */
  icon?: string;
  /** Optional badge node rendered next to the label (pill chrome only). */
  badge?: ReactNode;
}

export interface SecondaryPanelHeaderProps {
  position: SecondaryPanelPosition;
  tabs: SecondaryPanelHeaderTab[];
  activeTabKey: string;
  onTabChange: (key: string) => void;

  /** Per-tab action buttons. In `bottom` they sit inline; in `right` they
   *  drop to a second row. */
  tabActions?: ReactNode;
  /** Persistent controls (position toggle, close). Always on the tab row. */
  persistentActions?: ReactNode;

  /** Stable id used to namespace the TabBar's tab ids (right mode). */
  paneId: string;

  /** When true, per-tab actions stay invisible until the panel is hovered.
   *  Matches the existing editor / devtools "show on hover" UX. */
  hideTabActionsUntilHover?: boolean;

  /** Optional class for the outer wrapper (e.g. add `group/...` for hover). */
  className?: string;
}

const SecondaryPanelHeader: React.FC<SecondaryPanelHeaderProps> = memo(
  ({
    position,
    tabs,
    activeTabKey,
    onTabChange,
    tabActions,
    persistentActions,
    paneId,
    hideTabActionsUntilHover = false,
    className,
  }) => {
    // ------------------------------------------------------------------
    // Bottom (pill) mode
    // ------------------------------------------------------------------
    const pillTabs = useMemo(
      () =>
        tabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          badge: tab.badge,
        })),
      [tabs]
    );

    // ------------------------------------------------------------------
    // Right (TabBar) mode — convert to WorkStationTab shape
    // ------------------------------------------------------------------
    const tabBarTabId = useCallback(
      (key: string) => `${paneId}-${key}`,
      [paneId]
    );
    const tabBarTabs = useMemo<WorkStationTab[]>(
      () =>
        tabs.map((tab) => ({
          id: tabBarTabId(tab.key),
          type: "devtools",
          title: tab.label,
          icon: tab.icon,
          data: {},
          closable: false,
        })),
      [tabs, tabBarTabId]
    );
    const handleTabBarClick = useCallback(
      (tabId: string) => {
        const match = tabs.find((tab) => tabBarTabId(tab.key) === tabId);
        if (match) onTabChange(match.key);
      },
      [tabs, tabBarTabId, onTabChange]
    );
    const noopTabClose = useCallback((_tabId: string) => {}, []);

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------
    if (position === "bottom") {
      // Container-query driven layout. When the header is wide enough the
      // tab actions sit inline next to the persistent controls (single row).
      // When the header gets narrow (and buttons would start to overlap the
      // tabs), the per-tab actions wrap to their own row underneath —
      // matching the right-mode "second action row" structure.
      return (
        <div
          className={`shrink-0 bg-workstation-bg @container/spheader ${className ?? ""}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-y-1 pb-1.5 pt-1.5 @[520px]/spheader:h-10 @[520px]/spheader:flex-nowrap @[520px]/spheader:gap-x-1.5 @[520px]/spheader:py-0 @[520px]/spheader:pl-2 @[520px]/spheader:pr-2">
            <div className="secondary-panel-header__tab-scroll order-1 flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden pl-2 scrollbar-hide @[520px]/spheader:pl-0">
              <TabPill
                activeTab={activeTabKey}
                tabs={pillTabs}
                onChange={onTabChange}
                variant="pill"
                color="fill"
                fillWidth={false}
                size="small"
                className="shrink-0"
              />
            </div>
            <div className="order-2 flex items-center gap-px pr-2 @[520px]/spheader:order-3 @[520px]/spheader:pr-0">
              {persistentActions}
            </div>
            {tabActions && (
              <div
                className={`secondary-panel-header__tab-actions order-3 flex w-full items-center justify-end gap-1.5 pr-2 pt-1 @[520px]/spheader:order-2 @[520px]/spheader:w-auto @[520px]/spheader:p-0 ${
                  hideTabActionsUntilHover
                    ? "invisible group-hover/panel:visible"
                    : ""
                }`}
              >
                {tabActions}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Right mode: TabBar row + optional second action row.
    return (
      <div className={`flex shrink-0 flex-col ${className ?? ""}`}>
        <TabBar
          paneId={paneId}
          tabs={tabBarTabs}
          activeTabId={tabBarTabId(activeTabKey)}
          onTabClick={handleTabBarClick}
          onTabClose={noopTabClose}
          repoPath=""
          surfaceClassName="bg-workstation-bg"
          trailingSlot={
            persistentActions ? (
              <div className="flex items-center gap-px">
                {persistentActions}
              </div>
            ) : undefined
          }
        />
        {tabActions && (
          <div
            className={`flex h-8 shrink-0 items-center justify-end gap-1.5 px-3 ${
              hideTabActionsUntilHover
                ? "invisible group-hover/panel:visible"
                : ""
            }`}
          >
            {tabActions}
          </div>
        )}
      </div>
    );
  }
);

SecondaryPanelHeader.displayName = "SecondaryPanelHeader";

export default SecondaryPanelHeader;
