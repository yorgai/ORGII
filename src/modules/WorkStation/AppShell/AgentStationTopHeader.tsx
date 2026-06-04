/**
 * AgentStationTopHeader
 *
 * Drag-region header bar for the Agent-station variant of AppShell.
 * Contains: station mode chip, optional caption bar, chat panel toggle,
 * caption toggle, and layout settings dropdown.
 */
import { useAtom, useAtomValue } from "jotai";
import { Captions, Maximize2, MessageCircle, Minimize2 } from "lucide-react";
import React, {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import CaptionBar from "@src/engines/Simulator/components/CaptionBar";
import { useCurrentTurnLastAgentMessage } from "@src/engines/Simulator/hooks/useCurrentTurnLastAgentMessage";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import {
  COLLAPSED_SIDEBAR_CHROME_OFFSET,
  useShouldOffsetWorkStationTopBar,
} from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { useIsCompactLayout } from "@src/modules/shared/layouts/useCompactLayout";
import { CollapsedSidebarButton } from "@src/scaffold/NavigationSidebar/CollapsedSidebarButton";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import {
  activeStationChatVisibleAtom,
  chatWidthAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  simulatorCaptionBarEnabledAtom,
  simulatorEffectiveDockAppAtom,
} from "@src/store/ui/simulatorAtom";

import {
  NoDragRegion,
  SimulatorAgentChip,
  StationModeChip,
  TabBarTrailingIconButton,
} from "../shared";

const AgentStationTopHeader: React.FC = memo(() => {
  const { t } = useTranslation("sessions");
  const isCompactLayout = useIsCompactLayout();
  const shouldOffsetLeftChrome = useShouldOffsetWorkStationTopBar();
  const modeChipAreaRef = useRef<HTMLDivElement>(null);
  const trailingControlsRef = useRef<HTMLDivElement>(null);
  const getStationChatVisible = useAtomValue(activeStationChatVisibleAtom);
  const chatWidth = useAtomValue(chatWidthAtom);
  const isChatPanelVisible =
    getStationChatVisible("agent-station") && chatWidth > 0;
  const location = useLocation();
  // Settings occupies the chat-panel slot; SettingsSlot owns its own
  // maximize/restore button, so the workstation-side toggle is redundant
  // and visually conflicting (two buttons driving the same atom).
  const isSettingsRoute = location.pathname.startsWith("/orgii/app/settings");
  const effectiveDockApp = useAtomValue(simulatorEffectiveDockAppAtom);
  const [captionEnabled, setCaptionEnabled] = useAtom(
    simulatorCaptionBarEnabledAtom
  );
  const captionMessage = useCurrentTurnLastAgentMessage();
  const showAgentMessageNotice =
    captionMessage?.isCurrentEvent && effectiveDockApp === AppType.CHANNELS;
  const captionText = showAgentMessageNotice
    ? t("simulator.agentSentMessageCaption")
    : captionMessage?.text;
  const captionToggleLabel = t("simulator.captionBarToggleTooltip");
  const captionToggleShortcut = getShortcutKeys("toggle_captions");
  const chatPanelLabel = isChatPanelVisible
    ? t("chat.maximizeWorkStation")
    : t("chat.restoreChatPanel");
  const chatPanelShortcut = getShortcutKeys("maximize_work_station");

  const chatPanelTooltip = (
    <KeyboardShortcutTooltipContent
      label={chatPanelLabel}
      shortcut={chatPanelShortcut}
    />
  );

  const captionToggleTooltip = (
    <KeyboardShortcutTooltipContent
      label={captionToggleLabel}
      shortcut={captionToggleShortcut}
    />
  );

  const showCaptionBar = captionEnabled && !!captionMessage;

  const handleToggleCaption = useCallback(() => {
    setCaptionEnabled((prev) => !prev);
  }, [setCaptionEnabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const isCaptionsShortcut = isMac
        ? event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey
        : event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey;
      if (!isCaptionsShortcut || event.code !== "KeyC") return;
      event.preventDefault();
      event.stopPropagation();
      handleToggleCaption();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleToggleCaption]);

  const getCaptionPortalBounds = useCallback(() => {
    const modeRect = modeChipAreaRef.current?.getBoundingClientRect();
    const trailingRect = trailingControlsRef.current?.getBoundingClientRect();
    return {
      left: (modeRect?.right ?? 0) + 12,
      right: (trailingRect?.left ?? window.innerWidth) - 12,
    };
  }, []);

  const handleToggleChatPanel = useCallback(() => {
    startTransition(() => {
      void WorkStationViewService.showWorkStation();
    });
  }, []);

  return (
    <>
      <div
        className={`relative flex shrink-0 items-center ${isCompactLayout ? "h-11 min-h-11 pt-2" : "h-9 min-h-9"}`}
        data-tauri-drag-region
        style={
          {
            paddingLeft: shouldOffsetLeftChrome
              ? COLLAPSED_SIDEBAR_CHROME_OFFSET
              : undefined,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        {shouldOffsetLeftChrome ? (
          <NoDragRegion className="flex h-full items-center">
            <CollapsedSidebarButton />
          </NoDragRegion>
        ) : null}
        <NoDragRegion
          ref={modeChipAreaRef}
          className="flex h-full min-w-0 items-center gap-1 px-2"
        >
          <StationModeChip />
          <SimulatorAgentChip />
        </NoDragRegion>
        <NoDragRegion className="flex h-full min-w-0 flex-1 items-center justify-center px-2">
          {showCaptionBar && captionMessage ? (
            <div className="min-w-0 max-w-[min(600px,100%)]">
              <CaptionBar
                key={captionMessage.eventId}
                text={captionText ?? captionMessage.text}
                textTone={showAgentMessageNotice ? "primary" : "default"}
                getPortalBounds={getCaptionPortalBounds}
              />
            </div>
          ) : null}
        </NoDragRegion>
        <NoDragRegion
          ref={trailingControlsRef}
          className="ml-auto flex h-full shrink-0 items-center gap-px pl-1 pr-2"
        >
          <Tooltip
            content={captionToggleTooltip}
            position="bottom-end"
            mouseEnterDelay={200}
            framedPanel
          >
            <span className="inline-flex">
              <TabBarTrailingIconButton
                title={captionToggleLabel}
                nativeTitle={false}
                active={captionEnabled}
                aria-pressed={captionEnabled}
                onClick={handleToggleCaption}
              >
                <Captions size={16} strokeWidth={2} />
              </TabBarTrailingIconButton>
            </span>
          </Tooltip>
          {!isSettingsRoute && !isChatPanelVisible && (
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
          )}
          {!isSettingsRoute && (
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
          )}
        </NoDragRegion>
      </div>
    </>
  );
});

AgentStationTopHeader.displayName = "AgentStationTopHeader";

export default AgentStationTopHeader;
