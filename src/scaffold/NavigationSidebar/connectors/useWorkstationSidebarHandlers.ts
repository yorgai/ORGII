import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useSetAtom } from "jotai";
import { type Dispatch, type SetStateAction, useCallback } from "react";

import { deleteSession } from "@src/api/tauri/agent";
import { benchmarkApi } from "@src/api/tauri/benchmark";
import { rpc } from "@src/api/tauri/rpc";
import Message from "@src/components/Message";
import type { GoToNewSessionOptions } from "@src/hooks/navigation/useAppNavigation";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import {
  benchmarkActiveBatchIdAtom,
  benchmarkActiveBatchTaskIdAtom,
  benchmarkAgentBatchStatusAtom,
} from "@src/store/benchmark";
import {
  SESSION_SIDEBAR_PAGE_SIZE,
  type Session,
  type SessionListCategory,
  loadMoreCategory,
  removeSession,
  upsertSession,
} from "@src/store/session";
import {
  CHAT_PANEL_CONTENT_MODE,
  chatPanelContentModeAtom,
  chatPanelSelectedWorkItemAtom,
  chatPanelSelectedWorkspaceAtom,
  chatPanelStickyNotesOpenAtom,
  chatPanelWorkspaceDashboardOpenAtom,
} from "@src/store/ui/chatPanelAtom";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { isCliSession } from "@src/util/session/sessionDispatch";
import { getSessionListDisplayName } from "@src/util/session/sessionSidebarRow";

import {
  NEW_SESSION_MENU_ITEM_ID,
  getDraftIdFromMenuItemId,
} from "./sidebarConnectorUtils";

interface UseWorkstationSidebarHandlersParams {
  activeSessionId: string;
  selectedMenuItemId: string;
  sessionMap: Map<string, Session>;
  isLoadMoreId: (id: string) => SessionListCategory | null;
  getLoadMoreGroupId: (id: string) => string | null;
  sessionRouteLabel: string;
  goToNewSession: (options?: GoToNewSessionOptions) => void;
  navigateTo: (path: string) => void;
  openSession: (
    sessionId: string,
    sessionName?: string,
    repoPath?: string
  ) => void;
  promoteActiveSessionCreatorDraft: () => void;
  setGroupVisibleCounts: Dispatch<SetStateAction<Map<string, number>>>;
  tCommon: (key: string, defaultValue?: string) => string;
}

interface UseWorkstationSidebarHandlersResult {
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleExportMarkdown: (sessionId: string) => Promise<void>;
  handleMenuItemClick: (_key: string, item: NavigationMenuItem) => void;
  handleTogglePin: (sessionId: string) => Promise<void>;
  handleAddTag: (sessionId: string) => Promise<void>;
}

export function useWorkstationSidebarHandlers({
  activeSessionId,
  selectedMenuItemId,
  sessionMap,
  isLoadMoreId,
  getLoadMoreGroupId,
  sessionRouteLabel,
  goToNewSession,
  navigateTo,
  openSession,
  promoteActiveSessionCreatorDraft,
  setGroupVisibleCounts,
  tCommon,
}: UseWorkstationSidebarHandlersParams): UseWorkstationSidebarHandlersResult {
  const setChatPanelContentMode = useSetAtom(chatPanelContentModeAtom);
  const setBenchmarkAgentBatchStatus = useSetAtom(
    benchmarkAgentBatchStatusAtom
  );
  const setBenchmarkActiveBatchId = useSetAtom(benchmarkActiveBatchIdAtom);
  const setBenchmarkActiveBatchTaskId = useSetAtom(
    benchmarkActiveBatchTaskIdAtom
  );
  const setChatPanelWorkspaceDashboardOpen = useSetAtom(
    chatPanelWorkspaceDashboardOpenAtom
  );
  const setChatPanelSelectedWorkItem = useSetAtom(
    chatPanelSelectedWorkItemAtom
  );
  const setChatPanelSelectedWorkspace = useSetAtom(
    chatPanelSelectedWorkspaceAtom
  );
  const setChatPanelStickyNotesOpen = useSetAtom(chatPanelStickyNotesOpenAtom);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        if (isCliSession(sessionId)) {
          await invokeTauri("cli_agent_delete", { sessionId });
        } else {
          await deleteSession(sessionId);
        }
        removeSession(sessionId);

        if (sessionId === activeSessionId) {
          goToNewSession();
        }
      } catch (error) {
        console.error("[WorkstationSidebar] Failed to delete session:", error);
        Message.error(tCommon("sessions:chat.failedToDeleteSession"));
      }
    },
    [activeSessionId, goToNewSession, tCommon]
  );

  const handleExportMarkdown = useCallback(
    async (sessionId: string) => {
      try {
        const session = sessionMap.get(sessionId);
        const baseName =
          session?.name ||
          (session
            ? getSessionListDisplayName(session, sessionRouteLabel)
            : sessionRouteLabel);
        const suggestedName = `${baseName.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 60)}.md`;

        const filePath = await saveDialog({
          defaultPath: suggestedName,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!filePath) return;

        const markdown = await rpc.sessionCore.eventStore.exportMarkdown({
          sessionId,
        });
        await writeTextFile(filePath, markdown);
        Message.success(tCommon("sessions:chat.exportSuccess", "Exported!"));
      } catch (error) {
        console.error("[WorkstationSidebar] Export markdown failed:", error);
        Message.error(tCommon("sessions:chat.exportFailed", "Export failed"));
      }
    },
    [sessionMap, sessionRouteLabel, tCommon]
  );

  const handleMenuItemClick = useCallback(
    (_key: string, item: NavigationMenuItem) => {
      if (item.id === NEW_SESSION_MENU_ITEM_ID) {
        if (selectedMenuItemId === NEW_SESSION_MENU_ITEM_ID) return;
        goToNewSession();
        return;
      }

      const draftId = getDraftIdFromMenuItemId(item.id);
      if (draftId) {
        goToNewSession({ draftId });
        return;
      }

      if (item.routePath) {
        navigateTo(item.routePath);
        return;
      }

      const loadMoreGroupId = getLoadMoreGroupId(item.id);
      if (loadMoreGroupId) {
        setGroupVisibleCounts((previousCounts) => {
          const nextCounts = new Map(previousCounts);
          const current =
            nextCounts.get(loadMoreGroupId) ?? SESSION_SIDEBAR_PAGE_SIZE;
          nextCounts.set(loadMoreGroupId, current + SESSION_SIDEBAR_PAGE_SIZE);
          return nextCounts;
        });
        return;
      }

      const loadMoreCategory = isLoadMoreId(item.id);
      if (loadMoreCategory) {
        void loadMoreCategoryAction(loadMoreCategory);
        return;
      }

      const originalSession = sessionMap.get(item.id);
      if (!originalSession) return;

      const sessionName = getSessionListDisplayName(
        originalSession,
        sessionRouteLabel
      );

      if (isBenchmarkCoordinatorSession(originalSession)) {
        setChatPanelContentMode(
          CHAT_PANEL_CONTENT_MODE.BENCHMARK_SESSION_GROUP
        );
        setChatPanelSelectedWorkItem(null);
        setChatPanelWorkspaceDashboardOpen(false);
        setChatPanelSelectedWorkspace(null);
        setChatPanelStickyNotesOpen(false);
        promoteActiveSessionCreatorDraft();
        void benchmarkApi
          .listAgentBatchHistories({ limit: 100 })
          .then((histories) =>
            histories.find((history) => history.masterSessionId === item.id)
          )
          .then((history) => {
            if (!history) return;
            setBenchmarkAgentBatchStatus(history);
            setBenchmarkActiveBatchId(history.batchId);
            setBenchmarkActiveBatchTaskId(null);
          });
        openSession(item.id, sessionName, originalSession.repoPath);
        setChatPanelContentMode(
          CHAT_PANEL_CONTENT_MODE.BENCHMARK_SESSION_GROUP
        );
        return;
      }

      setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.SESSION);
      setChatPanelSelectedWorkItem(null);
      setChatPanelWorkspaceDashboardOpen(false);
      setChatPanelSelectedWorkspace(null);
      setChatPanelStickyNotesOpen(false);
      promoteActiveSessionCreatorDraft();
      openSession(item.id, sessionName, originalSession.repoPath);
    },
    [
      getLoadMoreGroupId,
      isLoadMoreId,
      sessionMap,
      openSession,
      goToNewSession,
      navigateTo,
      promoteActiveSessionCreatorDraft,
      selectedMenuItemId,
      sessionRouteLabel,
      setBenchmarkActiveBatchId,
      setBenchmarkActiveBatchTaskId,
      setBenchmarkAgentBatchStatus,
      setChatPanelContentMode,
      setChatPanelWorkspaceDashboardOpen,
      setChatPanelSelectedWorkspace,
      setChatPanelSelectedWorkItem,
      setChatPanelStickyNotesOpen,
      setGroupVisibleCounts,
    ]
  );

  const handleTogglePin = useCallback(
    async (sessionId: string) => {
      const session = sessionMap.get(sessionId);
      if (!session) return;
      const newPinned = !(session.pinned ?? false);
      upsertSession({ ...session, pinned: newPinned });
      try {
        await rpc.sessionAggregate.patch({
          sessionId,
          patch: { pinned: newPinned },
        });
      } catch (error) {
        upsertSession({ ...session, pinned: session.pinned ?? false });
        console.error("[WorkstationSidebar] Failed to toggle pin:", error);
      }
    },
    [sessionMap]
  );

  const handleAddTag = useCallback(
    async (sessionId: string) => {
      const session = sessionMap.get(sessionId);
      if (!session) return;
      const tag = window.prompt(
        tCommon("sessions:chat.addTagPrompt", "Add tag (e.g. review, infra):")
      );
      if (!tag || !tag.trim()) return;
      const trimmedTag = tag.trim().toLowerCase().replace(/\s+/g, "-");
      const currentTags = session.tags ?? [];
      if (currentTags.includes(trimmedTag)) return;
      const newTags = [...currentTags, trimmedTag];
      upsertSession({ ...session, tags: newTags });
      try {
        await rpc.sessionAggregate.patch({
          sessionId,
          patch: { tags: newTags },
        });
      } catch (error) {
        upsertSession({ ...session, tags: currentTags });
        console.error("[WorkstationSidebar] Failed to add tag:", error);
      }
    },
    [sessionMap, tCommon]
  );

  return {
    handleDeleteSession,
    handleExportMarkdown,
    handleMenuItemClick,
    handleTogglePin,
    handleAddTag,
  };
}

function loadMoreCategoryAction(
  sessionListCategory: SessionListCategory
): Promise<void> {
  return loadMoreCategory(sessionListCategory);
}

function isBenchmarkCoordinatorSession(session: Session): boolean {
  return session.user_input?.startsWith("Benchmark run coordinator\n") ?? false;
}
