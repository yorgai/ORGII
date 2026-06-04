/**
 * useWorkstationTrailingSlot
 *
 * Builds the trailing-slot ReactNode for WorkstationTabBar.
 * Extracted to isolate the complex conditional rendering logic
 * (Plus menu, Chat Panel toggle, Minimize/Restore control,
 * Project trailing bar) from the
 * main tab-bar component.
 */
import { useAtomValue, useSetAtom } from "jotai";
import {
  Maximize2,
  MessageCircle,
  Minimize2,
  PanelRight,
  X,
} from "lucide-react";
import { type ReactNode, startTransition, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import type { AppModeType } from "@src/config/viewModeTypes";
import ProjectManagerWorkItemsTabBarTrailing from "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectManagerWorkItemsTabBarTrailing";
import {
  TabBarPlusMenu,
  type TabBarPlusMenuItem,
} from "@src/modules/WorkStation/AppShell/TabBarPlusMenu";
import { TabBarTrailingIconButton } from "@src/modules/WorkStation/shared";
import { HEADER_ICON_SIZE } from "@src/modules/WorkStation/shared/tokens";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import {
  activeStationChatVisibleAtom,
  chatWidthAtom,
  toggleChatPanelMaximizedAtom,
} from "@src/store/ui/chatPanelAtom";
import { workStationChatPositionAtom } from "@src/store/ui/workStationAtom";
import { workstationProjectTabBarAtom } from "@src/store/workstation";

import type { UseWorkstationTabListReturn } from "./useWorkstationTabList";

const BROWSER_PLUS_MENU_ITEMS: readonly TabBarPlusMenuItem[] = [
  "newBrowserTab",
  "newPrivateBrowserTab",
];

export interface UseWorkstationTrailingSlotOptions {
  appMode: AppModeType;
  isAllTabsView: boolean;
  visible: UseWorkstationTabListReturn["visible"];
}

export interface UseWorkstationTrailingSlotReturn {
  trailingSlot: ReactNode;
  handleToggleChatPanel: () => void;
}

export function useWorkstationTrailingSlot({
  appMode,
  isAllTabsView,
  visible,
}: UseWorkstationTrailingSlotOptions): UseWorkstationTrailingSlotReturn {
  const { t } = useTranslation(["sessions", "common", "settings"]);
  const location = useLocation();
  const getStationChatVisible = useAtomValue(activeStationChatVisibleAtom);
  const chatWidth = useAtomValue(chatWidthAtom);
  const workStationChatPosition = useAtomValue(workStationChatPositionAtom);
  const projectTabBar = useAtomValue(workstationProjectTabBarAtom);
  const toggleChatPanelMaximized = useSetAtom(toggleChatPanelMaximizedAtom);

  const isChatPanelVisible =
    getStationChatVisible("my-station") && chatWidth > 0;
  // Settings occupies the chat-panel slot; SettingsSlot owns its own
  // maximize/restore button, so the workstation-side toggle is redundant
  // and visually conflicting (two buttons driving the same atom).
  const isSettingsRoute = location.pathname.startsWith("/orgii/app/settings");

  const handleToggleChatPanel = useMemo(
    () => () => {
      startTransition(() => {
        void WorkStationViewService.showWorkStation();
      });
    },
    []
  );

  const handleToggleChatPanelMaximized = useMemo(
    () => () => {
      toggleChatPanelMaximized();
    },
    [toggleChatPanelMaximized]
  );

  const trailingSlot = useMemo((): ReactNode => {
    const plusMenuControl = isAllTabsView ? (
      <TabBarPlusMenu />
    ) : appMode === "browser" ? (
      <TabBarPlusMenu items={BROWSER_PLUS_MENU_ITEMS} />
    ) : null;

    const chatPanelLabel = isChatPanelVisible
      ? t("sessions:chat.maximizeWorkStation")
      : t("sessions:chat.restoreChatPanel");
    const chatPanelShortcut = getShortcutKeys("maximize_work_station");
    const chatPanelTooltip = (
      <KeyboardShortcutTooltipContent
        label={chatPanelLabel}
        shortcut={chatPanelShortcut}
      />
    );

    const chatPanelControl = isSettingsRoute ? null : (
      <Tooltip
        content={chatPanelTooltip}
        position="bottom-end"
        mouseEnterDelay={200}
        framedPanel
      >
        <span className="inline-flex">
          <TabBarTrailingIconButton
            title={chatPanelLabel}
            nativeTitle={false}
            onClick={handleToggleChatPanel}
          >
            {isChatPanelVisible ? (
              <Maximize2 size={14} strokeWidth={2} />
            ) : (
              <MessageCircle size={14} strokeWidth={2} />
            )}
          </TabBarTrailingIconButton>
        </span>
      </Tooltip>
    );

    const hideWorkstationLabel = t("sessions:chat.hideWorkstation");
    const hideWorkstationTooltip = (
      <KeyboardShortcutTooltipContent
        label={hideWorkstationLabel}
        shortcut={getShortcutKeys("maximize_chat")}
      />
    );
    const maximizeChatControl =
      !isSettingsRoute && isChatPanelVisible ? (
        <Tooltip
          content={hideWorkstationTooltip}
          position="bottom-end"
          mouseEnterDelay={200}
          framedPanel
        >
          <span className="inline-flex">
            <TabBarTrailingIconButton
              title={hideWorkstationLabel}
              nativeTitle={false}
              onClick={handleToggleChatPanelMaximized}
            >
              {workStationChatPosition === "left" ? (
                <PanelRight size={HEADER_ICON_SIZE.md} strokeWidth={2} />
              ) : (
                <X size={HEADER_ICON_SIZE.md} strokeWidth={1.75} />
              )}
            </TabBarTrailingIconButton>
          </span>
        </Tooltip>
      ) : null;

    const shrinkWorkstationControl = !isSettingsRoute &&
      !isChatPanelVisible && (
        <Tooltip
          content={chatPanelTooltip}
          position="bottom-end"
          mouseEnterDelay={200}
          framedPanel
        >
          <span className="inline-flex">
            <TabBarTrailingIconButton
              title={chatPanelLabel}
              nativeTitle={false}
              onClick={handleToggleChatPanel}
            >
              <Minimize2 size={14} strokeWidth={2} />
            </TabBarTrailingIconButton>
          </span>
        </Tooltip>
      );

    // X close button shown only while the Settings slot is mounted:
    // hides the workstation surface and maximizes Settings. The
    // SettingsSlot's own Maximize2 button performs the same toggle from
    // the opposite side, so dismissing the workstation is reachable from
    // wherever the user's pointer currently is.
    const maximizeSettingsLabel = t("settings:panel.maximizeSettings");
    const maximizeSettingsTooltip = (
      <KeyboardShortcutTooltipContent
        label={maximizeSettingsLabel}
        shortcut={getShortcutKeys("maximize_chat")}
      />
    );
    const closeWorkstationControl = isSettingsRoute ? (
      <Tooltip
        content={maximizeSettingsTooltip}
        position="bottom-end"
        mouseEnterDelay={200}
        framedPanel
      >
        <span className="inline-flex">
          <TabBarTrailingIconButton
            title={maximizeSettingsLabel}
            nativeTitle={false}
            onClick={handleToggleChatPanelMaximized}
          >
            <X size={14} strokeWidth={2} />
          </TabBarTrailingIconButton>
        </span>
      </Tooltip>
    ) : null;

    if (appMode === "code") {
      return (
        <>
          {plusMenuControl}
          {shrinkWorkstationControl}
          {chatPanelControl}
          {maximizeChatControl}
          {closeWorkstationControl}
        </>
      );
    }

    if (appMode === "project" && projectTabBar) {
      const activeRawId =
        visible.find((entry) => entry.isActive)?.tab.id ??
        visible[0]?.tab.id ??
        null;
      return (
        <>
          {plusMenuControl}
          <ProjectManagerWorkItemsTabBarTrailing
            activeTabId={activeRawId}
            onAddProject={projectTabBar.onAddProject}
          />
          {shrinkWorkstationControl}
          {chatPanelControl}
          {maximizeChatControl}
          {closeWorkstationControl}
        </>
      );
    }

    return (
      <>
        {plusMenuControl}
        {shrinkWorkstationControl}
        {chatPanelControl}
        {maximizeChatControl}
        {closeWorkstationControl}
      </>
    );
  }, [
    appMode,
    handleToggleChatPanel,
    handleToggleChatPanelMaximized,
    isAllTabsView,
    isChatPanelVisible,
    isSettingsRoute,
    projectTabBar,
    t,
    visible,
    workStationChatPosition,
  ]);

  return { trailingSlot, handleToggleChatPanel };
}
