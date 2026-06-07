import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { FlaskConical, type LucideIcon, Search } from "lucide-react";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  PRIMARY_SIDEBAR_TABS,
  type PrimarySidebarTabKey,
  activeStatusBarAppAtom,
  workStationPrimarySidebarCollapsedPersistAtom,
  workStationPrimarySidebarTabAtom,
} from "@src/store/ui/workStationAtom";
import { opsControlPeekHostAtom } from "@src/store/workstation";
import {
  type WorkStationTab,
  activeWorkStationTabAtom,
} from "@src/store/workstation/tabs";

const CODE_SIDEBAR_HEADER_ACTIONS: Array<{
  key: PrimarySidebarTabKey;
  icon: LucideIcon;
  labelKey: string;
}> = [
  {
    key: PRIMARY_SIDEBAR_TABS.SEARCH,
    icon: Search,
    labelKey: "tabs.search",
  },
  {
    key: PRIMARY_SIDEBAR_TABS.TESTING,
    icon: FlaskConical,
    labelKey: "tabs.testing",
  },
];

function usesFallbackCodeSidebar(tab: WorkStationTab | null): boolean {
  if (!tab) return true;
  return (
    tab.type !== "agent-config" &&
    tab.type !== "source-control" &&
    tab.type !== "terminal" &&
    tab.type !== "benchmark" &&
    tab.type !== "launchpad-repo"
  );
}

const CodeSidebarHeaderActionsComponent: React.FC = () => {
  const { t } = useTranslation("common");
  const activeApp = useAtomValue(activeStatusBarAppAtom);
  const activeTab = useAtomValue(activeWorkStationTabAtom);
  const stationMode = useAtomValue(stationModeAtom);
  const opsControlPeekHost = useAtomValue(opsControlPeekHostAtom);
  const [activeSidebarTab, setActiveSidebarTab] = useAtom(
    workStationPrimarySidebarTabAtom
  );
  const setSidebarCollapsed = useSetAtom(
    workStationPrimarySidebarCollapsedPersistAtom
  );

  const handleSelect = useCallback(
    (tab: PrimarySidebarTabKey) => {
      const nextTab =
        activeSidebarTab === tab ? PRIMARY_SIDEBAR_TABS.FILES : tab;
      setActiveSidebarTab(nextTab);
      setSidebarCollapsed(false);
    },
    [activeSidebarTab, setActiveSidebarTab, setSidebarCollapsed]
  );

  if (stationMode === "ops-control" && opsControlPeekHost !== "code")
    return null;
  if (activeApp !== "code" || !usesFallbackCodeSidebar(activeTab)) return null;

  return (
    <div className="flex shrink-0 items-center gap-px">
      {CODE_SIDEBAR_HEADER_ACTIONS.map((action) => {
        const Icon = action.icon;
        const active = activeSidebarTab === action.key;
        const label = t(action.labelKey);
        const button = (
          <Button
            key={action.key}
            htmlType="button"
            variant="tertiary"
            size="small"
            iconOnly
            className={active ? "!bg-fill-2 !text-primary-6" : ""}
            onClick={() => handleSelect(action.key)}
            title={
              action.key === PRIMARY_SIDEBAR_TABS.SEARCH ? undefined : label
            }
            aria-label={label}
            icon={<Icon size={HEADER_ICON_SIZE.sm} strokeWidth={2} />}
          />
        );

        if (action.key !== PRIMARY_SIDEBAR_TABS.SEARCH) return button;

        return (
          <Tooltip
            key={action.key}
            content={
              <KeyboardShortcutTooltipContent
                label={label}
                shortcut={getShortcutKeys("search_files")}
              />
            }
            position="bottom-end"
            mouseEnterDelay={200}
            framedPanel
          >
            <span className="inline-flex">{button}</span>
          </Tooltip>
        );
      })}
    </div>
  );
};

export const CodeSidebarHeaderActions = memo(CodeSidebarHeaderActionsComponent);
CodeSidebarHeaderActions.displayName = "CodeSidebarHeaderActions";
