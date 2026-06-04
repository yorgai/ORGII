import { emit } from "@tauri-apps/api/event";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Clipboard,
  FolderOutput,
  GalleryThumbnails,
  Link2,
  ListChevronsDownUp,
  MoreHorizontal,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  type LinkedSession,
  type WorkItemData,
  type WorkItemFrontmatter,
  enrichedWorkItemToUI,
  projectApi,
  workItemDataToUI,
} from "@src/api/http/project";
import {
  BENCHMARK_EVALUATION_MODE,
  type BenchmarkEvaluationMode,
} from "@src/api/tauri/benchmark";
import Button from "@src/components/Button";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Message from "@src/components/Message";
import RegionNoticeButton from "@src/components/RegionNoticeButton";
import Select, { type SelectOption } from "@src/components/Select";
import SessionHoverCard from "@src/components/SessionHoverCard";
import Switch from "@src/components/Switch";
import TabPill from "@src/components/TabPill";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { useRouteViewMode } from "@src/config/routeViewModeConfig";
import {
  MAX_WIDTH as CHAT_MAX_WIDTH,
  MIN_WIDTH as CHAT_MIN_WIDTH,
} from "@src/engines/ChatPanel/config";
import {
  clearSessionAtom,
  eventsAtom,
} from "@src/engines/SessionCore/core/atoms";
import type { SessionLaunchSuccessInfo } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import { SESSION_CREATOR_LAUNCH_MODE } from "@src/features/SessionCreator/types";
import { useBenchmarkRun } from "@src/hooks/benchmark/useBenchmarkRun";
import { useBenchmarkTasks } from "@src/hooks/benchmark/useBenchmarkTasks";
import { useDropdownEngine } from "@src/hooks/dropdown";
import {
  COLLAPSED_SIDEBAR_CHROME_OFFSET,
  useShouldOffsetChatPanelHeader,
} from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { useWorkStationTabs } from "@src/hooks/workStation/tabs";
import { allAgentDefsAtom } from "@src/modules/MainApp/AgentOrgs/store/builtInAgentsAtom";
import CreateWorkItemView, {
  type CreatedWorkItemResult,
} from "@src/modules/ProjectManager/WorkItems/components/CreateWorkItemView";
import { TabBarTrailingIconButton } from "@src/modules/WorkStation/shared";
import { HEADER_ICON_SIZE } from "@src/modules/WorkStation/shared/tokens";
import { useIsCompactLayout } from "@src/modules/shared/layouts/useCompactLayout";
import { CollapsedSidebarButton } from "@src/scaffold/NavigationSidebar/CollapsedSidebarButton";
import { PresenceMenuButton } from "@src/scaffold/NavigationSidebar/blocks/SidebarBottomBar";
import { SessionImportExportModal } from "@src/scaffold/NavigationSidebar/connectors/SessionImportExportModal";
import { VerticalResizeHandle } from "@src/scaffold/Resize";
import { currentRepoAtom } from "@src/store/repo";
import {
  SESSION_TARGET_KIND,
  activeSessionIdAtom,
  sessionCreatorStateAtom,
  sessionsAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelCreateTarget,
  chatPanelContentModeAtom,
  chatPanelCreateTargetAtom,
  chatPanelMaximizedAtom,
  chatPanelSelectedWorkItemAtom,
  chatTurnPaginationEnabledAtom,
  chatWidthAtom,
  toggleChatPanelMaximizedAtom,
} from "@src/store/ui/chatPanelAtom";
import { triggerCollapseAllAtom } from "@src/store/ui/collapseStateAtom";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import { createBenchmarkTab } from "@src/store/workstation/tabs";
import { getDispatchCategory } from "@src/util/session/sessionDispatch";

import { useReloadSession } from "./ChatHistory/hooks/useReloadSession";
import ChatView from "./ChatView";
import LinkSessionToWorkItemModal from "./LinkSessionToWorkItemModal";
import WorkItemPanelView from "./WorkItemPanelView";
import { useChatPanelResize } from "./hooks/useChatPanelResize";
import { usePanelTitle } from "./hooks/usePanelTitle";
import type { ChatPanelProps, ChatPanelRegionNotice } from "./types";

// ============================================
// ChatPanel
// ============================================

const CHAT_PANEL_HEADER_ICON_SIZE = 14;
const CHAT_PANEL_HEADER_PROMINENT_ICON_SIZE = 16;
// Builtin Agent Architect — designs and maintains agents, agent orgs, and
// skills. Picking the "Create agent / skill" entry in the creator-target
// dropdown is a shortcut that opens a fresh Agent session with this agent
// pre-selected.
const AGENT_ARCHITECT_DEF_ID = "builtin:agent-architect";
const AI_WORK_ITEM_DEFAULT_TITLE = "AI Work Item Draft";

interface AiWorkItemLaunchMetadata {
  shortId: string;
  projectSlug: string;
  projectId: string;
  projectName: string;
  item: WorkItemData;
}

function isAiWorkItemLaunchMetadata(
  metadata: unknown
): metadata is AiWorkItemLaunchMetadata {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    "shortId" in metadata &&
    "item" in metadata
  );
}

const ChatPanel: React.FC<ChatPanelProps> = memo(
  ({
    useExternalWidth = false,
    sessionSidebarWidth = 0,
    embedded = false,
    active = true,
    position = "right",
    sessionCreatorSlot: SessionCreatorSlot,
  }) => {
    const { t } = useTranslation(["sessions", "common", "projects"]);
    const isLeftPosition = position === "left";
    const shouldOffsetHeaderForCollapsedSidebar =
      useShouldOffsetChatPanelHeader({
        position,
        useExternalWidth,
      });
    const isCompactLayout = useIsCompactLayout();

    // ── Session state ───────────────────────────────────────────────
    const { currentSessionId, panelTitle } = usePanelTitle();
    const sessions = useAtomValue(sessionsAtom);
    const activeSession = useMemo(
      () =>
        currentSessionId
          ? sessions.find((session) => session.session_id === currentSessionId)
          : undefined,
      [currentSessionId, sessions]
    );
    const handleReloadSession = useReloadSession(currentSessionId ?? null);
    const { openTab: openWorkStationTab } = useWorkStationTabs();
    const [contentMode, setContentMode] = useAtom(chatPanelContentModeAtom);
    const [createTarget, setCreateTarget] = useAtom(chatPanelCreateTargetAtom);
    const [workItemCreateDraft, setWorkItemCreateDraft] =
      useState<WorkItemDraft | null>(null);
    const [showWorkItemAgentCreator, setShowWorkItemAgentCreator] = useState(
      Boolean(SessionCreatorSlot)
    );
    const selectedWorkItem = useAtomValue(chatPanelSelectedWorkItemAtom);
    const currentRepo = useAtomValue(currentRepoAtom);
    const currentRepoPath = currentRepo?.path ?? currentRepo?.fs_uri ?? null;
    const {
      error: benchmarkError,
      isLoadingTasks: isLoadingBenchmarkTasks,
      selectedTaskId: selectedBenchmarkTaskId,
      setSelectedTaskId: setSelectedBenchmarkTaskId,
      tasks: benchmarkTasks,
    } = useBenchmarkTasks({
      loadDetail: false,
      loadOnMount: createTarget === CHAT_PANEL_CREATE_TARGET.BENCHMARK,
    });
    const {
      evaluationMode: benchmarkEvaluationMode,
      isRunLoading: isBenchmarkRunLoading,
      preflight: benchmarkPreflight,
      refreshPreflight: refreshBenchmarkPreflight,
      runError: benchmarkRunError,
      setEvaluationMode: setBenchmarkEvaluationMode,
      setTargetRepoPath: setBenchmarkTargetRepoPath,
      targetRepoPath: benchmarkTargetRepoPath,
    } = useBenchmarkRun();
    const createTargetOptions = useMemo<SelectOption[]>(
      () => [
        {
          value: CHAT_PANEL_CREATE_TARGET.AGENT_SESSION,
          label: t("creator.createTarget.agentSession"),
          dataTestId: "chat-panel-create-target-agent-session-option",
        },
        {
          value: CHAT_PANEL_CREATE_TARGET.CREATE_AGENT,
          label: t("creator.createTarget.createAgent"),
          dataTestId: "chat-panel-create-target-create-agent-option",
        },
        {
          value: CHAT_PANEL_CREATE_TARGET.WORK_ITEM,
          label: t("creator.createTarget.workItem"),
          dataTestId: "chat-panel-create-target-work-item-option",
        },
        {
          value: CHAT_PANEL_CREATE_TARGET.BENCHMARK,
          label: t("creator.createTarget.benchmark"),
          dataTestId: "chat-panel-create-target-benchmark-option",
        },
        {
          value: CHAT_PANEL_CREATE_TARGET.BATCH_START,
          label: t("creator.createTarget.batchStartBeta"),
          dataTestId: "chat-panel-create-target-batch-start-option",
        },
      ],
      [t]
    );

    // ── Header mode ─────────────────────────────────────────────────
    const viewMode = useRouteViewMode();
    const isChatFocus = useAtomValue(chatPanelMaximizedAtom);
    const toggleChatFocus = useSetAtom(toggleChatPanelMaximizedAtom);
    /**
     * Maximize/dock toggle: in WorkStation the chat panel can grow to fill the
     * entire content area. The button shows in WorkStation regardless of
     * session or station-mode state.
     */
    const showChatFocusToggle = viewMode === "workStation";

    // ── Width ────────────────────────────────────────────────────────
    const rawChatWidth = useAtomValue(chatWidthAtom);
    const chatWidth =
      rawChatWidth > 0 ? Math.min(rawChatWidth, CHAT_MAX_WIDTH) : rawChatWidth;

    // ── Resize ──────────────────────────────────────────────────────
    const { isDragging, panelRef, handleMouseDown } = useChatPanelResize({
      useExternalWidth,
      embedded,
      position,
    });

    const handleChatFocusToggle = useCallback(() => {
      toggleChatFocus();
    }, [toggleChatFocus]);

    const openSearchRef = React.useRef<(() => void) | null>(null);
    const {
      isOpen: isHeaderActionsOpen,
      isPositioned: isHeaderActionsPositioned,
      toggle: toggleHeaderActionsMenu,
      close: closeHeaderActionsMenu,
      triggerRef: headerActionsTriggerRef,
      panelRef: headerActionsDropdownRef,
      panelPosition: headerActionsPosition,
    } = useDropdownEngine<HTMLButtonElement>({
      gap: 4,
      align: "right",
      placement: "bottom",
    });

    const [regionNotice, setRegionNotice] =
      React.useState<ChatPanelRegionNotice | null>(null);
    const visibleRegionNotice = regionNotice;
    const handleRegionNoticeChange = useCallback(
      (notice: ChatPanelRegionNotice | null) => {
        setRegionNotice(notice);
      },
      []
    );

    const [paginationEnabled, setPaginationEnabled] = useAtom(
      chatTurnPaginationEnabledAtom
    );
    const [isExportModalOpen, setExportModalOpen] = useState(false);
    const [isLinkWorkItemModalOpen, setLinkWorkItemModalOpen] = useState(false);

    const triggerCollapseAll = useSetAtom(triggerCollapseAllAtom);
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setWorkstationActiveSessionId = useSetAtom(
      workstationActiveSessionIdAtom
    );
    const setSelectedWorkItem = useSetAtom(chatPanelSelectedWorkItemAtom);
    const dispatchClearSession = useSetAtom(clearSessionAtom);
    const creatorState = useAtomValue(sessionCreatorStateAtom);
    const setCreatorState = useSetAtom(sessionCreatorStateAtom);
    const allAgentDefs = useAtomValue(allAgentDefsAtom);

    const handleCollapseAll = useCallback(() => {
      if (currentSessionId) {
        triggerCollapseAll(currentSessionId);
      }
      closeHeaderActionsMenu();
    }, [triggerCollapseAll, currentSessionId, closeHeaderActionsMenu]);

    const handleRegisterSearchOpen = useCallback(
      (handler: (() => void) | null) => {
        openSearchRef.current = handler;
      },
      []
    );

    const handleOpenSearch = useCallback(() => {
      openSearchRef.current?.();
      closeHeaderActionsMenu();
    }, [closeHeaderActionsMenu]);

    const handleReloadFromMenu = useCallback(() => {
      handleReloadSession();
      closeHeaderActionsMenu();
    }, [handleReloadSession, closeHeaderActionsMenu]);

    const handlePaginationToggle = useCallback(
      (checked: boolean) => {
        setPaginationEnabled(checked);
      },
      [setPaginationEnabled]
    );

    const handleNewSession = useCallback(() => {
      setContentMode(CHAT_PANEL_CONTENT_MODE.SESSION);
      setSelectedWorkItem(null);
      dispatchClearSession();
      setWorkstationActiveSessionId(null);
      setActiveSessionId(null);
    }, [
      dispatchClearSession,
      setActiveSessionId,
      setContentMode,
      setSelectedWorkItem,
      setWorkstationActiveSessionId,
    ]);

    const events = useAtomValue(eventsAtom);
    const [copyEventJsonLabel, setCopyEventJsonLabel] = React.useState<
      "idle" | "copied" | "failed"
    >("idle");
    const handleCopyEventJson = useCallback(() => {
      const json = JSON.stringify(events, null, 2);
      navigator.clipboard
        .writeText(json)
        .then(() => {
          setCopyEventJsonLabel("copied");
          setTimeout(() => setCopyEventJsonLabel("idle"), 2000);
        })
        .catch(() => {
          setCopyEventJsonLabel("failed");
          setTimeout(() => setCopyEventJsonLabel("idle"), 2000);
        });
      closeHeaderActionsMenu();
    }, [events, closeHeaderActionsMenu]);

    const handleOpenExportSessionJson = useCallback(() => {
      setExportModalOpen(true);
      closeHeaderActionsMenu();
    }, [closeHeaderActionsMenu]);

    const handleCloseExportSessionJson = useCallback(() => {
      setExportModalOpen(false);
    }, []);

    const handleOpenLinkWorkItem = useCallback(() => {
      if (!currentSessionId) {
        Message.warning("Open a session before linking a Work Item.");
        return;
      }
      setLinkWorkItemModalOpen(true);
      closeHeaderActionsMenu();
    }, [closeHeaderActionsMenu, currentSessionId]);

    const handleCloseLinkWorkItem = useCallback(() => {
      setLinkWorkItemModalOpen(false);
    }, []);

    const handleSessionLinkedToWorkItem = useCallback(() => {
      void emit("orgii-data-changed", new Date().toISOString());
    }, []);

    // ── Render ───────────────────────────────────────────────────────
    /** When the resize handle is shown, it already draws the 1px seam — avoid border + handle (double line). */
    const showResizeHandle = !useExternalWidth;
    const borderClasses =
      embedded && !showResizeHandle
        ? isLeftPosition
          ? "border-r border-border-1"
          : "border-l border-border-1"
        : "";

    const dragHandle = showResizeHandle && (
      <VerticalResizeHandle
        onMouseDown={handleMouseDown}
        variant={embedded ? "border" : "transparent"}
        noAccent={!embedded}
      />
    );

    const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
    const sessionSidebarVisible = sessionSidebarWidth > 0;
    const showSessionContent =
      active &&
      contentMode === CHAT_PANEL_CONTENT_MODE.SESSION &&
      !!currentSessionId;
    const showWorkItemContent = !!selectedWorkItem && !showSessionContent;
    const showExplicitNonSessionContent =
      contentMode === CHAT_PANEL_CONTENT_MODE.NON_SESSION;
    const showNonSessionContent = !showWorkItemContent && !showSessionContent;
    const showPanelContent =
      active || showWorkItemContent || showExplicitNonSessionContent;
    const showHeader =
      showWorkItemContent ||
      showExplicitNonSessionContent ||
      (active && (showSessionContent || viewMode === "workStation"));
    const workItemTitle = selectedWorkItem?.workItem.name || "Work item";
    const headerTitle = selectedWorkItem
      ? currentSessionId
        ? `${workItemTitle} » ${panelTitle}`
        : workItemTitle
      : panelTitle;
    // The "+" (new session) button is redundant when the session sidebar is
    // visible, so only surface it in the chat header when that sidebar is off.
    const showNewSessionButton =
      showSessionContent && sidebarCollapsed && !sessionSidebarVisible;
    const isBenchmarkTarget =
      createTarget === CHAT_PANEL_CREATE_TARGET.BENCHMARK;
    const isWorkItemTarget =
      createTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM;
    const showCreatorPresenceInHeader =
      !showSessionContent &&
      !selectedWorkItem &&
      !isBenchmarkTarget &&
      !isWorkItemTarget;
    const showWorkItemAgentSwitchInHeader =
      showNonSessionContent &&
      !selectedWorkItem &&
      isWorkItemTarget &&
      Boolean(SessionCreatorSlot);
    const chatFocusLabel = isChatFocus
      ? t("chat.showWorkstation")
      : t("chat.hideWorkstation");
    const chatFocusShortcut = getShortcutKeys("maximize_chat");
    const chatFocusTooltip = (
      <KeyboardShortcutTooltipContent
        label={chatFocusLabel}
        shortcut={chatFocusShortcut}
      />
    );
    const shrinkToWorkstationLabel = t("chat.showWorkstation");
    const shrinkToWorkstationTooltip = (
      <KeyboardShortcutTooltipContent
        label={shrinkToWorkstationLabel}
        shortcut={chatFocusShortcut}
      />
    );
    const showEmptyChatFocusRestoreButton =
      !showSessionContent &&
      !selectedWorkItem &&
      isChatFocus &&
      showChatFocusToggle;

    const handleCreateTargetChange = useCallback(
      (value: string | number | (string | number)[]) => {
        if (Array.isArray(value)) return;
        const nextTarget = value as ChatPanelCreateTarget;

        // "Create agent / skill" is a one-shot shortcut, not a distinct
        // creator mode: pre-select the Agent Architect, open a fresh
        // session, and settle the dropdown back on "Agent session" (the
        // Architect is just an agent).
        if (nextTarget === CHAT_PANEL_CREATE_TARGET.CREATE_AGENT) {
          const architectDef = allAgentDefs.find(
            (definition) => definition.id === AGENT_ARCHITECT_DEF_ID
          );
          setCreatorState((prev) => ({
            ...prev,
            dispatchCategory: "rust_agent",
            targetKind: SESSION_TARGET_KIND.AGENT,
            selectedAgentDefinitionId: AGENT_ARCHITECT_DEF_ID,
            selectedAgentOrgId: null,
            agentName: architectDef?.name ?? prev.agentName,
            agentIconId: architectDef?.iconId ?? null,
            cliAgentType: null,
          }));
          handleNewSession();
          setCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
          setWorkItemCreateDraft(null);
          setShowWorkItemAgentCreator(Boolean(SessionCreatorSlot));
          return;
        }

        if (nextTarget !== CHAT_PANEL_CREATE_TARGET.WORK_ITEM) {
          setWorkItemCreateDraft(null);
          setShowWorkItemAgentCreator(Boolean(SessionCreatorSlot));
        }
        setCreateTarget(nextTarget);
        if (nextTarget === CHAT_PANEL_CREATE_TARGET.AGENT_SESSION) {
          handleNewSession();
        }
      },
      [
        SessionCreatorSlot,
        allAgentDefs,
        handleNewSession,
        setCreateTarget,
        setCreatorState,
      ]
    );

    const handleOpenBenchmarkTab = useCallback(() => {
      openWorkStationTab(createBenchmarkTab());
      if (isChatFocus) {
        toggleChatFocus();
      }
    }, [isChatFocus, openWorkStationTab, toggleChatFocus]);

    const handleCancelWorkItemCreate = useCallback(() => {
      setWorkItemCreateDraft(null);
      setShowWorkItemAgentCreator(Boolean(SessionCreatorSlot));
      setCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
      handleNewSession();
    }, [SessionCreatorSlot, handleNewSession, setCreateTarget]);

    const handleWorkItemAgentCreatorToggle = useCallback(
      (enabled: boolean) => {
        setShowWorkItemAgentCreator(Boolean(SessionCreatorSlot) && enabled);
      },
      [SessionCreatorSlot]
    );

    const handleChatPanelWorkItemCreated = useCallback(
      (result?: CreatedWorkItemResult) => {
        if (!result) return;
        const workItem =
          result.workItem ??
          (result.item
            ? workItemDataToUI(result.item, {
                labelMap: new Map(),
                memberMap: new Map(),
              })
            : null);
        if (!workItem) return;
        setSelectedWorkItem({
          shortId: result.shortId,
          projectSlug: result.projectSlug ?? "",
          projectId:
            result.item?.frontmatter.project ?? workItem.project?.id ?? "",
          projectName: workItem.project?.name ?? "",
          workItem,
        });
        if (!result.keepOpen) {
          setWorkItemCreateDraft(null);
          setShowWorkItemAgentCreator(Boolean(SessionCreatorSlot));
          setCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
          setContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
          dispatchClearSession();
          setWorkstationActiveSessionId(null);
          setActiveSessionId(null);
        }
      },
      [
        SessionCreatorSlot,
        dispatchClearSession,
        setActiveSessionId,
        setContentMode,
        setCreateTarget,
        setSelectedWorkItem,
        setWorkstationActiveSessionId,
      ]
    );

    const resolveAiWorkItemAssignee = useCallback(
      (draft: WorkItemDraft) => {
        if (draft.assigneeType === "agent" && draft.assigneeId) {
          const agentName =
            allAgentDefs.find((agent) => agent.id === draft.assigneeId)?.name ??
            draft.assigneeId;
          return {
            assigneeId: draft.assigneeId,
            assigneeType: "agent",
            assigneeName: agentName,
            agentDefinitionId: draft.assigneeId,
          };
        }

        if (draft.assigneeType === "org" && draft.assigneeId) {
          return {
            assigneeId: draft.assigneeId,
            assigneeType: "org",
            assigneeName: creatorState.agentName ?? draft.assigneeId,
            agentDefinitionId: draft.orchestratorConfig?.agent_definition_id,
          };
        }

        if (
          creatorState.targetKind === SESSION_TARGET_KIND.AGENT_ORG &&
          creatorState.selectedAgentOrgId
        ) {
          return {
            assigneeId: creatorState.selectedAgentOrgId,
            assigneeType: "org",
            assigneeName:
              creatorState.agentName ?? creatorState.selectedAgentOrgId,
            agentDefinitionId:
              creatorState.selectedAgentDefinitionId ?? undefined,
          };
        }

        if (creatorState.selectedAgentDefinitionId) {
          const agent = allAgentDefs.find(
            (definition) =>
              definition.id === creatorState.selectedAgentDefinitionId
          );
          return {
            assigneeId: creatorState.selectedAgentDefinitionId,
            assigneeType: "agent",
            assigneeName:
              agent?.name ??
              creatorState.agentName ??
              creatorState.selectedAgentDefinitionId,
            agentDefinitionId: creatorState.selectedAgentDefinitionId,
          };
        }

        return null;
      },
      [
        allAgentDefs,
        creatorState.agentName,
        creatorState.selectedAgentDefinitionId,
        creatorState.selectedAgentOrgId,
        creatorState.targetKind,
      ]
    );

    const resolveAiWorkItemContext = useCallback(async () => {
      const draft = workItemCreateDraft;
      if (!draft) return null;

      const assignee = resolveAiWorkItemAssignee(draft);
      if (!assignee) {
        Message.error("Choose an agent assignee before creating with AI.");
        return null;
      }

      const projects = await projectApi.readProjects();
      const selectedProject = draft.projectId
        ? projects.find((project) => project.meta.id === draft.projectId)
        : projects[0];
      const selectedProjectSlug = selectedProject?.slug ?? "";
      const selectedProjectId =
        selectedProject?.meta.id ?? draft.projectId ?? "";
      const selectedProjectName = selectedProject?.meta.name ?? "";
      const now = new Date().toISOString();
      const shortId = selectedProjectSlug
        ? await projectApi.allocateWorkItemId(selectedProjectSlug)
        : await projectApi.allocateStandaloneWorkItemId();
      const title = draft.name.trim() || AI_WORK_ITEM_DEFAULT_TITLE;
      const description = draft.description.trim();
      const frontmatter: WorkItemFrontmatter = {
        id: shortId,
        short_id: shortId,
        title,
        project: selectedProjectId || undefined,
        status: draft.status || "planned",
        priority: draft.priority || "none",
        assignee: assignee.assigneeId,
        assignee_type: assignee.assigneeType,
        labels: draft.labelIds,
        milestone: draft.milestoneId,
        start_date: draft.startDate,
        target_date: draft.targetDate,
        created_at: now,
        updated_at: now,
        starred: false,
        todos: [],
        orchestrator_config: {
          ...(draft.orchestratorConfig ?? {
            review_enabled: false,
            follow_up_enabled: false,
            auto_retry_on_failure: false,
            max_retry_count: 0,
            auto_create_pr: false,
          }),
          agent_definition_id: assignee.agentDefinitionId,
          org_id:
            assignee.assigneeType === "org" ? assignee.assigneeId : undefined,
        },
        schedule: draft.schedule ?? undefined,
      };

      if (selectedProjectSlug) {
        await projectApi.writeWorkItem(
          selectedProjectSlug,
          shortId,
          frontmatter,
          description
        );
      } else {
        await projectApi.writeStandaloneWorkItem(
          shortId,
          frontmatter,
          description
        );
      }

      const item: WorkItemData = {
        frontmatter,
        body: description,
        filename: `${shortId}.md`,
      };

      return {
        workItemId: shortId,
        projectSlug: selectedProjectSlug || undefined,
        agentRole: "custom",
        metadata: {
          shortId,
          projectSlug: selectedProjectSlug,
          projectId: selectedProjectId,
          projectName: selectedProjectName,
          item,
        },
      };
    }, [resolveAiWorkItemAssignee, workItemCreateDraft]);

    const handleAiWorkItemSessionStart = useCallback(
      async (info: SessionLaunchSuccessInfo) => {
        const metadata = info.workItemContext?.metadata;
        if (!isAiWorkItemLaunchMetadata(metadata)) return;

        const startedAt = new Date().toISOString();
        const linkedSession: LinkedSession = {
          session_id: info.sessionId,
          session_type:
            getDispatchCategory(info.sessionId) === "cli_agent"
              ? "cli"
              : "native",
          agent_role: "custom",
          started_at: startedAt,
          status: "running",
          cost_usd: 0,
          total_tokens: 0,
          result_preview: "Plan",
        };
        const updatedItem: WorkItemData = {
          ...metadata.item,
          frontmatter: {
            ...metadata.item.frontmatter,
            linked_sessions: [linkedSession],
            updated_at: startedAt,
          },
        };

        if (metadata.projectSlug) {
          await projectApi.updateWorkItemPartial(
            metadata.projectSlug,
            metadata.shortId,
            { linkedSessions: [linkedSession] }
          );
        } else {
          await projectApi.writeStandaloneWorkItem(
            metadata.shortId,
            updatedItem.frontmatter,
            updatedItem.body
          );
        }

        const workItem = workItemDataToUI(updatedItem, {
          labelMap: new Map(),
          memberMap: new Map(),
        });
        setSelectedWorkItem({
          shortId: metadata.shortId,
          projectSlug: metadata.projectSlug,
          projectId: metadata.projectId,
          projectName: metadata.projectName,
          workItem,
        });
        setShowWorkItemAgentCreator(Boolean(SessionCreatorSlot));
        setWorkItemCreateDraft(null);
        setCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        setContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        dispatchClearSession();
        setWorkstationActiveSessionId(null);
        setActiveSessionId(null);
        await emit("orgii-data-changed");
      },
      [
        SessionCreatorSlot,
        dispatchClearSession,
        setActiveSessionId,
        setContentMode,
        setCreateTarget,
        setSelectedWorkItem,
        setWorkstationActiveSessionId,
      ]
    );

    const defaultAiWorkItemAssignee = useMemo(() => {
      const fallbackDraft: WorkItemDraft = {
        name: "",
        description: "",
        status: "planned",
        priority: "none",
        labelIds: [],
      };
      const resolved = resolveAiWorkItemAssignee(
        workItemCreateDraft ?? fallbackDraft
      );
      if (!resolved) return null;
      return {
        id: resolved.assigneeId,
        name: resolved.assigneeName,
        type: resolved.assigneeType as "agent" | "org",
        agentDefinitionId: resolved.agentDefinitionId,
      };
    }, [resolveAiWorkItemAssignee, workItemCreateDraft]);

    const handleWorkItemTitleChange = useCallback(
      (title: string) => {
        if (!selectedWorkItem || title === selectedWorkItem.workItem.name) {
          return;
        }

        const previousSelectedWorkItem = selectedWorkItem;
        setSelectedWorkItem({
          ...selectedWorkItem,
          workItem: {
            ...selectedWorkItem.workItem,
            name: title,
          },
        });

        projectApi
          .updateWorkItemPartial(
            selectedWorkItem.projectSlug,
            selectedWorkItem.shortId,
            {
              title,
            }
          )
          .then((updatedWorkItem) => {
            setSelectedWorkItem((currentSelectedWorkItem) => {
              if (
                !currentSelectedWorkItem ||
                currentSelectedWorkItem.projectSlug !==
                  selectedWorkItem.projectSlug ||
                currentSelectedWorkItem.shortId !== selectedWorkItem.shortId
              ) {
                return currentSelectedWorkItem;
              }

              return {
                ...currentSelectedWorkItem,
                workItem: enrichedWorkItemToUI(updatedWorkItem),
              };
            });
            return emit("orgii-data-changed");
          })
          .catch(() => {
            setSelectedWorkItem((currentSelectedWorkItem) => {
              if (
                !currentSelectedWorkItem ||
                currentSelectedWorkItem.projectSlug !==
                  previousSelectedWorkItem.projectSlug ||
                currentSelectedWorkItem.shortId !==
                  previousSelectedWorkItem.shortId
              ) {
                return currentSelectedWorkItem;
              }
              return previousSelectedWorkItem;
            });
          });
      },
      [selectedWorkItem, setSelectedWorkItem]
    );

    const headerToolbar = (
      <div
        className="flex h-9 flex-shrink-0 items-center gap-px"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {showSessionContent && (
          <Tooltip
            content={
              <KeyboardShortcutTooltipContent label={t("chat.collapseAll")} />
            }
            position="bottom-end"
            mouseEnterDelay={200}
            framedPanel
          >
            <span className="inline-flex">
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                onClick={handleCollapseAll}
                aria-label={t("chat.collapseAll")}
                icon={
                  <ListChevronsDownUp
                    size={CHAT_PANEL_HEADER_ICON_SIZE}
                    strokeWidth={2}
                  />
                }
              />
            </span>
          </Tooltip>
        )}
        {visibleRegionNotice && (
          <RegionNoticeButton
            title={visibleRegionNotice.title}
            body={<p className="m-0">{visibleRegionNotice.body}</p>}
            alertClassName="!border-border-2 !bg-chat-container !text-text-1 shadow-lg"
          />
        )}
        {showSessionContent && (
          <Tooltip
            content={
              <KeyboardShortcutTooltipContent
                label={t("common:actions.more")}
              />
            }
            position="bottom-end"
            mouseEnterDelay={200}
            framedPanel
          >
            <span className="inline-flex">
              <Button
                ref={headerActionsTriggerRef}
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                className={
                  isHeaderActionsOpen ? "!bg-fill-1 !text-primary-6" : ""
                }
                onClick={(event) => {
                  event.stopPropagation();
                  toggleHeaderActionsMenu();
                }}
                aria-label={t("common:actions.more")}
                aria-expanded={isHeaderActionsOpen}
                data-testid="chat-panel-header-more-button"
                icon={
                  <MoreHorizontal
                    size={CHAT_PANEL_HEADER_ICON_SIZE}
                    strokeWidth={2}
                  />
                }
              />
            </span>
          </Tooltip>
        )}
        {isChatFocus && showChatFocusToggle && (
          <Tooltip
            content={shrinkToWorkstationTooltip}
            position="bottom-end"
            mouseEnterDelay={200}
            framedPanel
          >
            <span className="inline-flex">
              <TabBarTrailingIconButton
                title={shrinkToWorkstationLabel}
                nativeTitle={false}
                onClick={handleChatFocusToggle}
              >
                {isLeftPosition ? (
                  <PanelRight size={HEADER_ICON_SIZE.md} strokeWidth={1.75} />
                ) : (
                  <GalleryThumbnails
                    size={HEADER_ICON_SIZE.md}
                    strokeWidth={1.75}
                  />
                )}
              </TabBarTrailingIconButton>
            </span>
          </Tooltip>
        )}
        {showNewSessionButton && (
          <Tooltip
            content={
              <KeyboardShortcutTooltipContent
                label={t("chat.newSession")}
                shortcut={getShortcutKeys("new_session")}
              />
            }
            position="bottom-end"
            mouseEnterDelay={200}
            framedPanel
          >
            <span className="inline-flex">
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                onClick={handleNewSession}
                aria-label={t("chat.newSession")}
                icon={
                  <Plus
                    size={CHAT_PANEL_HEADER_PROMINENT_ICON_SIZE}
                    strokeWidth={2}
                  />
                }
              />
            </span>
          </Tooltip>
        )}
        {isHeaderActionsOpen &&
          isHeaderActionsPositioned &&
          createPortal(
            <div
              ref={headerActionsDropdownRef}
              className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.sidebarMenuClass}`}
              style={{
                position: "fixed",
                top: headerActionsPosition.top,
                right: headerActionsPosition.right,
                zIndex: 9999,
              }}
            >
              <button
                type="button"
                className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left`}
                onClick={handleOpenSearch}
              >
                <Search size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
                <span className="flex-1 truncate">{t("chat.findInChat")}</span>
              </button>
              <button
                type="button"
                className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left disabled:cursor-not-allowed disabled:opacity-50`}
                onClick={handleReloadFromMenu}
                disabled={!showSessionContent}
              >
                <RefreshCw size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
                <span className="flex-1 truncate">
                  {t("common:actions.reload")}
                </span>
              </button>
              <button
                type="button"
                className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left disabled:cursor-not-allowed disabled:opacity-50`}
                onClick={handleCopyEventJson}
                disabled={events.length === 0}
              >
                <Clipboard size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
                <span className="flex-1 truncate">
                  {copyEventJsonLabel === "copied"
                    ? t("chat.copyEventJsonCopied")
                    : copyEventJsonLabel === "failed"
                      ? t("chat.copyEventJsonFailed")
                      : t("chat.copyEventJson")}
                </span>
              </button>
              <button
                type="button"
                className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left disabled:cursor-not-allowed disabled:opacity-50`}
                onClick={handleOpenLinkWorkItem}
                disabled={!currentSessionId}
                data-testid="session-link-work-item-button"
              >
                <Link2 size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
                <span className="flex-1 truncate">Link to Work Item…</span>
              </button>
              <button
                type="button"
                className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left disabled:cursor-not-allowed disabled:opacity-50`}
                onClick={handleOpenExportSessionJson}
                disabled={!activeSession}
              >
                <FolderOutput
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.75}
                />
                <span className="flex-1 truncate">
                  {t("chat.importExport.exportAction")}
                </span>
              </button>
              <div className="my-1 border-t border-solid border-border-2" />
              <div
                className={`${DROPDOWN_CLASSES.item} w-full justify-between text-left`}
              >
                <span className="flex-1 truncate">
                  {t("common:pagination.title")}
                </span>
                <Switch
                  checked={paginationEnabled}
                  onChange={handlePaginationToggle}
                  size="small"
                />
              </div>
            </div>,
            document.body
          )}
      </div>
    );

    const headerSection = showHeader && (
      <div
        className={`workspace-header header-tab-group relative flex flex-shrink-0 items-center gap-1.5 ${isCompactLayout ? "h-11 min-h-11 pl-2 pr-[7px] pt-2" : "h-9 min-h-9 px-2"}`}
        data-testid="chat-panel-header"
        data-tauri-drag-region
        style={
          {
            paddingLeft: shouldOffsetHeaderForCollapsedSidebar
              ? COLLAPSED_SIDEBAR_CHROME_OFFSET
              : undefined,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        {shouldOffsetHeaderForCollapsedSidebar ? (
          <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <CollapsedSidebarButton />
          </div>
        ) : null}
        {showNonSessionContent && !selectedWorkItem && (
          <div
            className="flex h-9 w-auto flex-shrink-0 items-center"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <Select
              value={createTarget}
              options={createTargetOptions}
              onChange={handleCreateTargetChange}
              size="small"
              variant="ghost"
              radius="pill"
              dropdownMinWidth={168}
              dropdownWidthMode="auto"
              className="w-auto"
              selectorClassName="!h-7 max-w-[180px] !gap-1.5 !rounded-lg !border-0 !bg-transparent !px-1.5 !text-[13px] font-medium !text-text-1 hover:!bg-surface-hover [&_.select-suffix]:!ml-0 [&_.select-value]:-translate-y-px"
              dataTestId="chat-panel-create-target-select"
            />
            {showCreatorPresenceInHeader && (
              <>
                <div
                  className="mx-2 h-4 w-px shrink-0 bg-border-2"
                  role="separator"
                  aria-hidden
                />
                <PresenceMenuButton dropdownPosition="bottom-end" />
              </>
            )}
            {showWorkItemAgentSwitchInHeader && (
              <>
                <div
                  className="mx-2 h-4 w-px shrink-0 bg-border-2"
                  role="separator"
                  aria-hidden
                />
                <label className="flex h-7 shrink-0 items-center gap-2 rounded-lg px-1.5 text-[12px] font-medium text-text-1 transition-colors hover:bg-surface-hover">
                  <span className="-translate-y-px">
                    {t("projects:workItems.createModes.useAi")}
                  </span>
                  <Switch
                    size="small"
                    checked={showWorkItemAgentCreator}
                    onChange={handleWorkItemAgentCreatorToggle}
                    ariaLabel={t("projects:workItems.createModes.useAi")}
                    dataTestId="chat-panel-work-item-agent-switch"
                  />
                </label>
              </>
            )}
          </div>
        )}
        {showSessionContent || selectedWorkItem ? (
          <>
            <div
              className="flex h-9 min-w-0 shrink items-center"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              {showSessionContent || (selectedWorkItem && currentSessionId) ? (
                <SessionHoverCard sessionId={currentSessionId}>
                  <span className="flex h-7 min-w-0 max-w-full cursor-default items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-text-1 transition-colors hover:bg-surface-hover">
                    <span
                      className="min-w-0 -translate-y-px truncate"
                      data-testid="chat-panel-header-title"
                    >
                      {headerTitle}
                    </span>
                  </span>
                </SessionHoverCard>
              ) : (
                <Input
                  type="text"
                  value={headerTitle}
                  onChange={handleWorkItemTitleChange}
                  readOnly={!selectedWorkItem}
                  borderless
                  bgless
                  size="small"
                  className="h-7 min-w-0 max-w-full cursor-default rounded-lg transition-colors hover:bg-surface-hover [&_.input-inner]:!px-1.5"
                  inputClassName="-translate-y-px truncate text-[13px] font-medium text-text-1"
                  data-testid="chat-panel-header-title-input"
                />
              )}
            </div>
            <div
              className="min-w-0 flex-1"
              aria-hidden
              data-tauri-drag-region
              style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            />
          </>
        ) : (
          <div
            className="min-w-0 flex-1"
            aria-hidden
            data-tauri-drag-region
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          />
        )}
        {headerToolbar}
      </div>
    );

    const useFullScreenCreator =
      isChatFocus || useExternalWidth || chatWidth >= CHAT_MAX_WIDTH;
    const creatorVariant = useFullScreenCreator ? "fullScreen" : "default";
    const creatorClassName = "min-h-0 flex-1";
    const benchmarkEvaluationModeOptions = useMemo<SelectOption[]>(
      () => [
        {
          value: BENCHMARK_EVALUATION_MODE.LOCAL_DOCKER,
          label: t("creator.benchmark.localDocker"),
        },
        {
          value: BENCHMARK_EVALUATION_MODE.PATCH_ONLY,
          label: t("creator.benchmark.patchOnlyWorktree"),
        },
      ],
      [t]
    );
    const isBenchmarkPatchOnlyMode =
      benchmarkEvaluationMode === BENCHMARK_EVALUATION_MODE.PATCH_ONLY;
    const benchmarkPreflightReadyCount =
      benchmarkPreflight?.checks.filter((check) => check.ok).length ?? 0;
    const benchmarkPreflightTotalCount = benchmarkPreflight?.checks.length ?? 0;
    const benchmarkTaskOptions = useMemo<SelectOption[]>(
      () =>
        benchmarkTasks.map((task) => ({
          value: task.taskId,
          triggerLabel: task.taskId,
          label: (
            <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
              <span className="truncate text-[12px] font-medium text-text-1">
                {task.taskId}
              </span>
              <span className="truncate text-[11px] text-text-3">
                {task.repo ? `${task.repo} · ` : ""}
                {task.title}
              </span>
            </span>
          ),
        })),
      [benchmarkTasks]
    );

    const handleBenchmarkTaskChange = useCallback(
      (value: string | number | (string | number)[]) => {
        if (Array.isArray(value)) return;
        setSelectedBenchmarkTaskId(String(value));
      },
      [setSelectedBenchmarkTaskId]
    );

    const handleBenchmarkEvaluationModeChange = useCallback(
      (value: string | number | (string | number)[]) => {
        if (typeof value === "string") {
          setBenchmarkEvaluationMode(value as BenchmarkEvaluationMode);
        }
      },
      [setBenchmarkEvaluationMode]
    );

    const handleBenchmarkPreflight = useCallback(() => {
      void refreshBenchmarkPreflight();
    }, [refreshBenchmarkPreflight]);

    const emptyChatContent = (() => {
      if (createTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM) {
        const sessionCreatorContent =
          showWorkItemAgentCreator && SessionCreatorSlot ? (
            <SessionCreatorSlot
              className="min-h-0 flex-1"
              variant={creatorVariant}
              centerFullScreenContent
              hidePresenceButton
              launchMode={SESSION_CREATOR_LAUNCH_MODE.START_BACKGROUND}
              onRegionNoticeChange={handleRegionNoticeChange}
              onSessionStart={handleAiWorkItemSessionStart}
              resolveWorkItemContext={resolveAiWorkItemContext}
            />
          ) : null;

        if (sessionCreatorContent) {
          return (
            <div
              className={`flex flex-col overflow-hidden ${creatorClassName}`}
            >
              <div className="h-[42%] min-h-[300px] shrink-0 overflow-hidden">
                <CreateWorkItemView
                  repoPath={currentRepoPath}
                  onCancel={handleCancelWorkItemCreate}
                  onSetUnsaved={() => undefined}
                  onWorkItemCreated={handleChatPanelWorkItemCreated}
                  onDraftChange={setWorkItemCreateDraft}
                  showCloseAction={false}
                  propertiesOpen={false}
                  showPropertiesAction={false}
                  aiGenerateMode={showWorkItemAgentCreator}
                  onAiGenerateModeChange={handleWorkItemAgentCreatorToggle}
                  showAiModePanel={false}
                  showFooter
                  chatPanelFooter
                  defaultAiAssignee={defaultAiWorkItemAssignee}
                />
              </div>
              <div className="shrink-0 px-4 pb-4">
                <div className="border-t border-border-2" aria-hidden />
                <div className="mt-4 flex items-center justify-start">
                  <TabPill
                    tabs={[
                      { key: "agent", label: t("common:terminology.agent") },
                    ]}
                    activeTab="agent"
                    onChange={() => undefined}
                    variant="simple"
                    fillWidth={false}
                    size="large"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {sessionCreatorContent}
              </div>
            </div>
          );
        }

        return (
          <div className={`flex overflow-hidden ${creatorClassName}`}>
            <CreateWorkItemView
              repoPath={currentRepoPath}
              onCancel={handleCancelWorkItemCreate}
              onSetUnsaved={() => undefined}
              onWorkItemCreated={handleChatPanelWorkItemCreated}
              onDraftChange={setWorkItemCreateDraft}
              showCloseAction={false}
              propertiesOpen={false}
              showPropertiesAction={false}
              aiGenerateMode={showWorkItemAgentCreator}
              onAiGenerateModeChange={handleWorkItemAgentCreatorToggle}
              showAiModePanel={false}
              showFooter
              chatPanelFooter
              defaultAiAssignee={defaultAiWorkItemAssignee}
            />
          </div>
        );
      }

      if (createTarget === CHAT_PANEL_CREATE_TARGET.BENCHMARK) {
        if (!SessionCreatorSlot) return null;

        return (
          <SessionCreatorSlot
            className={creatorClassName}
            variant={creatorVariant}
            centerFullScreenContent
            hidePresenceButton
            onRegionNoticeChange={handleRegionNoticeChange}
            footerSlot={
              <div className="flex flex-col gap-2">
                <section className="rounded-xl border border-solid border-border-2 p-4">
                  <div className="mb-3 text-[13px] font-semibold text-text-1">
                    {t("creator.benchmark.taskSelectionTitle")}
                  </div>

                  <Select
                    value={selectedBenchmarkTaskId ?? undefined}
                    options={benchmarkTaskOptions}
                    onChange={handleBenchmarkTaskChange}
                    placeholder={t("creator.benchmark.taskSelectStubOption")}
                    loading={isLoadingBenchmarkTasks}
                    disabled={
                      isLoadingBenchmarkTasks || benchmarkTasks.length === 0
                    }
                    showSearch
                    size="small"
                    radius="lg"
                    dropdownMinWidth={280}
                    className="w-full"
                  />
                  {benchmarkError ? (
                    <InlineAlert
                      type="danger"
                      title={t("common:errors.failedToLoad")}
                      className="mt-2 !py-2"
                    >
                      <p className="m-0 break-words text-[12px] leading-5">
                        {benchmarkError}
                      </p>
                    </InlineAlert>
                  ) : !isLoadingBenchmarkTasks &&
                    benchmarkTasks.length === 0 ? (
                    <p className="m-0 mt-2 text-[12px] leading-5 text-text-3">
                      {t("creator.benchmark.emptyTasks")}
                    </p>
                  ) : null}
                </section>

                <section className="rounded-xl border border-solid border-border-2 p-4">
                  <div className="mb-3 text-[13px] font-semibold text-text-1">
                    {t("creator.benchmark.evaluationModeTitle")}
                  </div>
                  <Select
                    value={benchmarkEvaluationMode}
                    options={benchmarkEvaluationModeOptions}
                    onChange={handleBenchmarkEvaluationModeChange}
                    size="small"
                    radius="lg"
                    className="w-full"
                  />
                  <p className="m-0 mt-2 text-[12px] leading-5 text-text-3">
                    {isBenchmarkPatchOnlyMode
                      ? t("creator.benchmark.patchOnlyWorktreeDescription")
                      : t("creator.benchmark.localDockerDescription")}
                  </p>
                  {isBenchmarkPatchOnlyMode && (
                    <Input
                      value={benchmarkTargetRepoPath}
                      onChange={setBenchmarkTargetRepoPath}
                      placeholder={t(
                        "creator.benchmark.targetRepoPathPlaceholder"
                      )}
                      size="small"
                      className="mt-2"
                      allowClear
                    />
                  )}
                  <InlineAlert
                    type={benchmarkPreflight?.ready ? "success" : "warning"}
                    title={
                      benchmarkPreflight
                        ? t("creator.benchmark.preflightSummary", {
                            ready: benchmarkPreflightReadyCount,
                            total: benchmarkPreflightTotalCount,
                          })
                        : t("creator.benchmark.preflightTitle")
                    }
                    className="mt-2 !py-2"
                    action={{
                      label: t("creator.benchmark.runPreflight"),
                      onClick: handleBenchmarkPreflight,
                      disabled:
                        isBenchmarkRunLoading || !selectedBenchmarkTaskId,
                    }}
                  >
                    {benchmarkRunError ? (
                      <p className="m-0 break-words text-[12px] leading-5">
                        {benchmarkRunError}
                      </p>
                    ) : null}
                  </InlineAlert>
                </section>

                <Button
                  htmlType="button"
                  variant="secondary"
                  size="small"
                  onClick={handleOpenBenchmarkTab}
                  className="self-start"
                >
                  {t("creator.benchmark.openWorkstationTab")}
                </Button>
              </div>
            }
          />
        );
      }

      if (SessionCreatorSlot) {
        return (
          <SessionCreatorSlot
            className={creatorClassName}
            variant={creatorVariant}
            centerFullScreenContent
            hidePresenceButton
            onRegionNoticeChange={handleRegionNoticeChange}
            batchStartMode={
              createTarget === CHAT_PANEL_CREATE_TARGET.BATCH_START
            }
          />
        );
      }

      return null;
    })();

    const chatColumn = (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!showPanelContent ? null : showWorkItemContent ? (
          <WorkItemPanelView selectedWorkItem={selectedWorkItem} />
        ) : showSessionContent ? (
          <ChatView
            sessionId={currentSessionId}
            onRegisterSearchOpen={handleRegisterSearchOpen}
            turnPaginationEnabled={paginationEnabled}
          />
        ) : (
          emptyChatContent
        )}
        {showEmptyChatFocusRestoreButton && (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center px-4">
            <Tooltip
              content={chatFocusTooltip}
              position="top"
              mouseEnterDelay={200}
              framedPanel
            >
              <span className="pointer-events-auto inline-flex">
                <Button
                  htmlType="button"
                  variant="secondary"
                  appearance="outline"
                  size="default"
                  shape="round"
                  onClick={handleChatFocusToggle}
                  aria-label={chatFocusLabel}
                  icon={<GalleryThumbnails size={15} strokeWidth={2} />}
                >
                  {chatFocusLabel}
                </Button>
              </span>
            </Tooltip>
          </div>
        )}
      </div>
    );

    const mainPanel = (
      <div
        ref={panelRef}
        data-chat-panel
        data-testid="chat-panel"
        className={`relative flex h-full max-w-full flex-col overflow-hidden bg-chat-pane text-sm ${
          useExternalWidth ? "min-w-0 flex-1" : "flex-shrink-0"
        } ${borderClasses}`}
        style={{
          ...(useExternalWidth ? { width: "100%" } : { width: chatWidth }),
          minWidth:
            !useExternalWidth && chatWidth > 0 ? CHAT_MIN_WIDTH : undefined,
          borderRadius: embedded ? 0 : "var(--radius-page)",
          contain: isDragging ? "strict" : undefined,
          willChange: isDragging ? "width" : undefined,
        }}
      >
        {headerSection}
        {chatColumn}
      </div>
    );

    return (
      <>
        <div
          className={`relative flex h-full ${isLeftPosition ? "flex-row-reverse" : "flex-row"} ${useExternalWidth ? "w-full min-w-0" : "flex-shrink-0"}`}
        >
          {dragHandle}
          {mainPanel}
        </div>
        <LinkSessionToWorkItemModal
          open={isLinkWorkItemModalOpen}
          sessionId={currentSessionId ?? null}
          onClose={handleCloseLinkWorkItem}
          onLinked={handleSessionLinkedToWorkItem}
        />
        <SessionImportExportModal
          visible={isExportModalOpen}
          mode="export"
          activeSession={activeSession}
          sessionFallbackName={t("chat.defaultTitle")}
          onClose={handleCloseExportSessionJson}
          onImported={() => undefined}
        />
      </>
    );
  }
);

ChatPanel.displayName = "ChatPanel";

export default ChatPanel;
