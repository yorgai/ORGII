import { emit } from "@tauri-apps/api/event";
import { useCallback, useMemo } from "react";

import {
  type LinkedSession,
  type WorkItemData,
  type WorkItemFrontmatter,
  projectApi,
  workItemDataToUI,
} from "@src/api/http/project";
import Message from "@src/components/Message";
import type { SessionLaunchSuccessInfo } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import i18n from "@src/i18n";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import { SESSION_TARGET_KIND } from "@src/store/session";
import type { SessionCreatorState } from "@src/store/session/creatorStateAtom";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelContentMode,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
} from "@src/store/ui/chatPanelAtom";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import { getDispatchCategory } from "@src/util/session/sessionDispatch";

const WORK_ITEM_DEFAULT_AGENT_DEF_ID = "builtin:work-item-manager";
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
    typeof metadata === "object" &&
    metadata !== null &&
    "shortId" in metadata &&
    "item" in metadata
  );
}

interface ResolvedAiWorkItemAssignee {
  assigneeId: string;
  assigneeType: "agent" | "org";
  assigneeName: string;
  agentDefinitionId?: string;
}

interface UseAiWorkItemCreatorOptions {
  allAgentDefs: AgentDefinition[];
  creatorState: SessionCreatorState;
  dispatchClearSession: () => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setContentMode: (mode: ChatPanelContentMode) => void;
  setCreateTarget: (target: ChatPanelCreateTarget) => void;
  setSelectedProject: (project: ChatPanelSelectedProject | null) => void;
  setSelectedWorkItem: (workItem: ChatPanelSelectedWorkItem | null) => void;
  setShowWorkItemAgentCreator: (enabled: boolean) => void;
  setWorkItemCreateDraft: (draft: WorkItemDraft | null) => void;
  setWorkstationActiveSessionId: (sessionId: string | null) => void;
  sessionCreatorAvailable: boolean;
  workItemCreateDraft: WorkItemDraft | null;
}

export function useAiWorkItemCreator({
  allAgentDefs,
  creatorState,
  dispatchClearSession,
  setActiveSessionId,
  setContentMode,
  setCreateTarget,
  setSelectedProject,
  setSelectedWorkItem,
  setShowWorkItemAgentCreator,
  setWorkItemCreateDraft,
  setWorkstationActiveSessionId,
  sessionCreatorAvailable,
  workItemCreateDraft,
}: UseAiWorkItemCreatorOptions) {
  const resolveAiWorkItemAssignee = useCallback(
    (draft: WorkItemDraft): ResolvedAiWorkItemAssignee | null => {
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

      const fallbackAgent = allAgentDefs.find(
        (definition) => definition.id === WORK_ITEM_DEFAULT_AGENT_DEF_ID
      );
      if (fallbackAgent) {
        return {
          assigneeId: fallbackAgent.id,
          assigneeType: "agent",
          assigneeName: fallbackAgent.name,
          agentDefinitionId: fallbackAgent.id,
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
      Message.error(i18n.t("toasts.chooseAgentAssigneeAi"));
      return null;
    }

    const projects = await projectApi.readProjects();
    const selectedProject = draft.projectId
      ? projects.find((project) => project.meta.id === draft.projectId)
      : undefined;
    const selectedProjectSlug = selectedProject?.slug ?? "";
    const selectedProjectId = selectedProject?.meta.id ?? draft.projectId ?? "";
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
      agentRole: "custom" as const,
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
      setSelectedProject(null);
      setSelectedWorkItem({
        shortId: metadata.shortId,
        projectSlug: metadata.projectSlug,
        projectId: metadata.projectId,
        projectName: metadata.projectName,
        workItem,
      });
      setShowWorkItemAgentCreator(sessionCreatorAvailable);
      setWorkItemCreateDraft(null);
      setCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
      setContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
      dispatchClearSession();
      setWorkstationActiveSessionId(null);
      setActiveSessionId(null);
      await emit("orgii-data-changed");
    },
    [
      dispatchClearSession,
      sessionCreatorAvailable,
      setActiveSessionId,
      setContentMode,
      setCreateTarget,
      setSelectedProject,
      setSelectedWorkItem,
      setShowWorkItemAgentCreator,
      setWorkItemCreateDraft,
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
      type: resolved.assigneeType,
      agentDefinitionId: resolved.agentDefinitionId,
    };
  }, [resolveAiWorkItemAssignee, workItemCreateDraft]);

  return {
    defaultAiWorkItemAssignee,
    handleAiWorkItemSessionStart,
    resolveAiWorkItemContext,
  };
}
