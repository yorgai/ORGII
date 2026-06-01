/**
 * SessionReplayMessages Component
 *
 * Communication replay interface for chat, think, interaction, and todo events.
 *
 * Uses WorkStationShell for consistent layout.
 * Structure:
 * - Left: Sidebar (Internal dialogue / Interactions / Todo List)
 * - Right: ReplayTabBar (event-driven tabs) + stacked event viewer
 */
import { useAtom, useAtomValue } from "jotai";
import React, { Suspense, lazy, memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import { useAgentOrgRunView } from "@src/engines/ChatPanel/InputArea/components/useAgentOrgRunView";
import EventWrapper from "@src/engines/ChatPanel/adapters/EventWrapper";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  getPlanEventAliases,
  isPlanDisplayEvent,
  planAliasesContain,
} from "@src/engines/SessionCore/derived/planDisplayEvents";
import type { SimulatorAppBaseState } from "@src/engines/Simulator/apps/core/types";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import { matchesCanvasEvent } from "@src/modules/WorkStation/Canvas/config";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { canvasPreviewAtom } from "@src/store/session/canvasPreviewAtom";
import { simulatorEffectiveDockAppAtom } from "@src/store/ui/simulatorAtom";
import type { BackendEvent } from "@src/types/session/steps";

import {
  FileHeader,
  SimulatorReplayChrome,
  WorkStationShell,
  buildPrimarySidebarConfig,
} from "../../shared";
import MessageViewer from "./MessageViewer";
import { useMessages } from "./useMessages";
import { usePlanApproval } from "./usePlanApproval";
import { useReplayTabs } from "./useReplayTabs";

const LazySimulatorCanvas = lazy(
  () => import("@src/modules/WorkStation/Canvas")
);

const HIDDEN_PRIMARY_SIDEBAR_CONFIG = buildPrimarySidebarConfig({
  content: null,
  collapsed: true,
  size: 0,
});

export interface SimulatorMessagesProps {
  currentEvent?: unknown;
  mode?: "interactive" | "simulation";
  customControls?: React.ReactNode;
  /** Explicit session ID — preferred over sessionIdAtom for WorkStation contexts
   *  where the global atom may not reflect the currently rendered SDE session. */
  sessionId?: string | null;
}

const SimulatorMessagesComponent: React.FC<SimulatorMessagesProps> = ({
  currentEvent,
  mode = "simulation",
  sessionId: propSessionId,
}) => {
  const { t } = useTranslation("sessions");
  const effectiveDockApp = useAtomValue(simulatorEffectiveDockAppAtom);

  const {
    viewMode,
    setViewMode,
    chatMessages,
    interactionMessages,
    state,
    hasLocalSelection,
    jumpToMessage,
  } = useMessages();

  const previewMessages = useMemo(
    () =>
      interactionMessages.filter((message) =>
        isPlanDisplayEvent(message.event)
      ),
    [interactionMessages]
  );

  const transcriptMessages = useMemo(() => {
    const combined = [
      ...chatMessages,
      ...state.todoMessages,
      ...interactionMessages,
    ];
    combined.sort((messageA, messageB) => {
      const timestampDelta =
        new Date(messageA.timestamp).getTime() -
        new Date(messageB.timestamp).getTime();
      return timestampDelta || messageA.order - messageB.order;
    });
    return combined;
  }, [chatMessages, state.todoMessages, interactionMessages]);

  const currentMessages =
    viewMode === "chat"
      ? transcriptMessages
      : viewMode === "todo"
        ? state.todoMessages
        : viewMode === "think"
          ? state.thinkMessages
          : viewMode === "preview"
            ? previewMessages
            : interactionMessages;
  const selectedMessageIsPlan = Boolean(
    state.selectedMessage?.event &&
    isPlanDisplayEvent(state.selectedMessage.event)
  );

  const { replayTabs, activeTabId, handleTabClick } = useReplayTabs({
    viewMode,
    setViewMode,
  });

  const headerBreadcrumbLabel = useMemo(() => {
    if (viewMode === "todo") {
      return t("simulator.replay.channelsSidebar.kanban");
    }
    if (viewMode === "interaction") {
      return t("simulator.replay.channelsSidebar.interactions");
    }
    if (viewMode === "preview") {
      return t("common:common.preview");
    }
    return t("simulator.replay.channelsSidebar.messages");
  }, [t, viewMode]);

  const headerFilePath = headerBreadcrumbLabel;

  const {
    activePlanMessage,
    isPlanDoc,
    isPlanPending,
    isPreviewMode,
    setIsPreviewMode,
  } = usePlanApproval({
    interactionMessages,
    selectedMessage: state.selectedMessage,
    viewMode,
  });

  const handleMessageClick = useCallback(
    (messageId: string) => {
      jumpToMessage(messageId);
      if (
        previewMessages.some((message) =>
          planAliasesContain(getPlanEventAliases(message.event), messageId)
        )
      ) {
        setViewMode("preview");
      }
    },
    [jumpToMessage, previewMessages, setViewMode]
  );

  const planTrailingSlot =
    isPlanDoc && isPlanPending ? (
      <div className="flex h-full items-center gap-2 px-2">
        <TabPill
          activeTab={isPreviewMode ? "preview" : "source"}
          tabs={[
            { key: "source", label: t("common:common.sourceCode") },
            { key: "preview", label: t("common:common.preview") },
          ]}
          onChange={(key) => setIsPreviewMode(key === "preview")}
          variant="pill"
          fillWidth={false}
          size="small"
        />
      </div>
    ) : null;

  const atomSessionId = useAtomValue(sessionIdAtom);
  // Prefer the explicitly passed sessionId (WorkStation Build context) over the
  // global atom, which may lag or point to a different surface's active session.
  const sessionId = propSessionId ?? atomSessionId;

  const [canvasPreview, setCanvasPreview] = useAtom(canvasPreviewAtom);
  const activeCanvasPayload =
    canvasPreview?.sessionId === sessionId ? canvasPreview.payload : null;

  // Resolve org-run member info so simulator message bubbles can show the
  // correct sender label (e.g. "Planner updated task" instead of the
  // generic "Agent"). One hook instance per Communication panel — bubbles
  // receive a stable lookup map rather than each calling the hook
  // themselves (which would multiply the 2.5s polling timer).
  const { view: agentOrgRunView } = useAgentOrgRunView(sessionId);
  const orgMembers = useMemo(
    () => agentOrgRunView?.members ?? [],
    [agentOrgRunView]
  );

  const noopSelectItem = useCallback((_itemId: string) => {}, []);

  const handleCanvasClose = useCallback(() => {
    setCanvasPreview(null);
  }, [setCanvasPreview]);

  // Handle canvas events (early return AFTER all hooks)
  const sessionEvent = currentEvent as SessionEvent | undefined;
  const currentFunctionName = sessionEvent?.functionName ?? "";
  if (matchesCanvasEvent(currentFunctionName)) {
    return (
      <EventWrapper
        event={currentEvent as unknown as BackendEvent}
        mode={mode}
        expand={true}
        padding="p-0"
      >
        <Suspense
          fallback={
            <Placeholder
              variant="loading"
              placement="detail-panel"
              fillParentHeight
              title="Loading…"
            />
          }
        >
          <LazySimulatorCanvas
            state={{} as SimulatorAppBaseState}
            selectedItemId={null}
            onSelectItem={noopSelectItem}
            currentEvent={currentEvent}
            mode={mode}
          />
        </Suspense>
      </EventWrapper>
    );
  }

  const mainContent = (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <MessageViewer
        messages={currentMessages}
        viewMode={viewMode}
        setViewMode={setViewMode}
        orgMembers={orgMembers}
        sessionReplayMode={mode}
        planPreviewMode={isPlanDoc ? isPreviewMode : undefined}
        planDocPending={isPlanDoc && isPlanPending}
        activePlanMessage={activePlanMessage}
        selectedMessage={state.selectedMessage}
        previewSelectedPlan={
          viewMode === "preview" && (hasLocalSelection || selectedMessageIsPlan)
        }
        onMessageClick={handleMessageClick}
        currentEventId={state.currentEventId}
        canvasPayload={activeCanvasPayload}
        onCanvasClose={handleCanvasClose}
      />
    </div>
  );

  return (
    <EventWrapper
      event={currentEvent as unknown as BackendEvent}
      mode={mode}
      expand={true}
      padding="p-0"
    >
      <SimulatorReplayChrome
        tabs={replayTabs}
        activeEventId={activeTabId}
        onTabClick={handleTabClick}
        trailingSlot={planTrailingSlot}
        sidebarToggleDisabled
        showWorkstationTabHeader={false}
      >
        <FileHeader
          filePath={headerFilePath}
          useFileTypeIcon={false}
          disableNavigation
          plainTitle
          publishToHost="simulator"
          publishEnabled={effectiveDockApp === AppType.CHANNELS}
        />
        <div className="flex min-h-0 flex-1">
          <WorkStationShell
            primarySidebarConfig={HIDDEN_PRIMARY_SIDEBAR_CONFIG}
            content={mainContent}
            statusBar={null}
            appClassName="session-replay-messages"
          />
        </div>
      </SimulatorReplayChrome>
    </EventWrapper>
  );
};

export const SessionReplayMessages = memo(SimulatorMessagesComponent);
SessionReplayMessages.displayName = "SessionReplayMessages";

export { SessionReplayMessages as SimulatorMessages };
export default SessionReplayMessages;
