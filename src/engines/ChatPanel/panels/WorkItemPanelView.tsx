import { emit } from "@tauri-apps/api/event";
import { useSetAtom } from "jotai";
import { ExternalLink, X } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type WorkItemFrontmatter,
  type WorkItemPartialUpdate,
  enrichedWorkItemToUI,
  projectApi,
} from "@src/api/http/project";
import Button from "@src/components/Button";
import { createLogger } from "@src/hooks/logger";
import {
  WorkItemContent,
  WorkItemProperties,
} from "@src/modules/ProjectManager/WorkItems/components";
import { WORK_ITEM_PROPERTY_INLINE_FIELDS } from "@src/modules/ProjectManager/WorkItems/components/WorkItemProperties";
import { activeSessionIdAtom } from "@src/store/session";
import {
  type ChatPanelSelectedWorkItem,
  chatPanelSelectedWorkItemAtom,
} from "@src/store/ui/chatPanelAtom";
import type { WorkItem } from "@src/types/core/workItem";

import ChatView from "../ChatView";

const logger = createLogger("WorkItemPanelView");
interface WorkItemPanelViewProps {
  selectedWorkItem: ChatPanelSelectedWorkItem;
  onUpdateWorkItem?: (updates: Partial<WorkItem>) => void;
}

function toStandaloneFrontmatter(
  workItem: WorkItem,
  shortId: string
): WorkItemFrontmatter {
  const now = new Date().toISOString();
  return {
    id: shortId,
    short_id: shortId,
    title: workItem.name,
    project: workItem.project?.id,
    status: workItem.workItemStatus ?? workItem.status ?? "backlog",
    priority: workItem.priority ?? "none",
    assignee: workItem.assignee?.id,
    assignee_type: workItem.assigneeType,
    labels: workItem.labels?.map((label) => label.id) ?? [],
    milestone: workItem.milestone?.id,
    start_date: workItem.startDate,
    target_date: workItem.endDate ?? workItem.target_date ?? undefined,
    created_at: workItem.created_time || now,
    updated_at: now,
    starred: workItem.star ?? false,
    todos:
      workItem.todos?.map((todo) => ({
        id: todo.id,
        content: todo.content,
        status: todo.status,
      })) ?? [],
    comments: workItem.comments,
    linked_sessions: workItem.linkedSessions,
    proof_of_work: workItem.proofOfWork,
    orchestrator_config: workItem.orchestratorConfig,
    orchestrator_state: workItem.orchestratorState,
    schedule: workItem.schedule ?? undefined,
    routine_source: workItem.routineSource,
    execution_lock: workItem.executionLock,
    close_out: workItem.closeOut,
    work_products: workItem.workProducts,
  };
}

function applyWorkItemPatch(
  workItem: WorkItem,
  updates: Partial<WorkItem>
): WorkItem {
  return {
    ...workItem,
    ...updates,
    updated_time: new Date().toISOString(),
  };
}

function toWorkItemPartialUpdate(
  updates: Partial<WorkItem>
): WorkItemPartialUpdate {
  const payload: WorkItemPartialUpdate = {};

  if (updates.name !== undefined) payload.title = updates.name;
  if (updates.spec !== undefined) payload.body = updates.spec;
  if (updates.workItemStatus !== undefined) {
    payload.status = updates.workItemStatus;
  }
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.project?.id) payload.project = updates.project.id;
  if (updates.star !== undefined) payload.starred = updates.star;
  if ("assignee" in updates) payload.assignee = updates.assignee?.id ?? null;
  if ("assigneeType" in updates) {
    payload.assigneeType = updates.assigneeType ?? null;
  }
  if ("labels" in updates) {
    payload.labels = updates.labels?.map((label) => label.id) ?? [];
  }
  if ("milestone" in updates) {
    payload.milestone = updates.milestone?.id ?? null;
  }
  if ("startDate" in updates) payload.startDate = updates.startDate ?? null;
  if ("endDate" in updates) payload.targetDate = updates.endDate ?? null;
  if ("target_date" in updates) {
    payload.targetDate = updates.target_date ?? null;
  }
  if (updates.todos !== undefined) {
    payload.todos = updates.todos.map((todo) => ({
      id: todo.id,
      content: todo.content,
      status: todo.status,
    }));
  }
  if (updates.comments !== undefined) {
    payload.comments = updates.comments.map((comment) => ({
      id: comment.id,
      author: comment.author,
      content: comment.content,
      created_at: comment.created_at,
    }));
  }
  if (updates.linkedSessions !== undefined) {
    payload.linkedSessions = updates.linkedSessions;
  }
  if (updates.orchestratorConfig !== undefined) {
    payload.orchestratorConfig = updates.orchestratorConfig;
  }
  if (updates.orchestratorState !== undefined) {
    payload.orchestratorState = updates.orchestratorState;
  }
  if (updates.schedule !== undefined) payload.schedule = updates.schedule;
  if (updates.executionLock !== undefined) {
    payload.executionLock = updates.executionLock;
  }
  if (updates.closeOut !== undefined) payload.closeOut = updates.closeOut;
  if (updates.workProducts !== undefined) {
    payload.workProducts = updates.workProducts;
  }

  return payload;
}

export const WorkItemPanelView: React.FC<WorkItemPanelViewProps> = ({
  selectedWorkItem,
  onUpdateWorkItem,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  const setSelectedWorkItem = useSetAtom(chatPanelSelectedWorkItemAtom);
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);
  const [floatingSessionId, setFloatingSessionId] = useState<string | null>(
    null
  );

  const handleUpdateWorkItem = useCallback(
    async (updates: Partial<WorkItem>) => {
      if (onUpdateWorkItem) {
        onUpdateWorkItem(updates);
        return;
      }

      try {
        const payload = toWorkItemPartialUpdate(updates);
        if (Object.keys(payload).length === 0) return;

        if (selectedWorkItem.projectSlug) {
          const updatedWorkItem = enrichedWorkItemToUI(
            await projectApi.updateWorkItemPartial(
              selectedWorkItem.projectSlug,
              selectedWorkItem.shortId,
              payload
            )
          );
          setSelectedWorkItem({
            ...selectedWorkItem,
            workItem: updatedWorkItem,
          });
        } else {
          const updatedWorkItem = applyWorkItemPatch(
            selectedWorkItem.workItem,
            updates
          );
          await projectApi.writeStandaloneWorkItem(
            selectedWorkItem.shortId,
            toStandaloneFrontmatter(updatedWorkItem, selectedWorkItem.shortId),
            updatedWorkItem.spec ?? ""
          );
          setSelectedWorkItem({
            ...selectedWorkItem,
            workItem: updatedWorkItem,
          });
        }
        await emit("orgii-data-changed");
      } catch (error) {
        logger.error("Failed to update chat panel work item", error);
      }
    },
    [onUpdateWorkItem, selectedWorkItem, setSelectedWorkItem]
  );

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      setFloatingSessionId(sessionId);
      setActiveSessionId(sessionId);
    },
    [setActiveSessionId]
  );

  const handleCloseFloatingSession = useCallback(() => {
    setFloatingSessionId(null);
  }, []);

  const linkedSessions = useMemo(
    () => selectedWorkItem.workItem.linkedSessions ?? [],
    [selectedWorkItem.workItem.linkedSessions]
  );
  const activeLinkedSession = linkedSessions.find(
    (session) => session.status === "running"
  );
  const floatingSession = useMemo(
    () =>
      floatingSessionId
        ? linkedSessions.find(
            (session) => session.session_id === floatingSessionId
          )
        : undefined,
    [floatingSessionId, linkedSessions]
  );

  const workItemContentKey = `${selectedWorkItem.projectSlug}:${
    selectedWorkItem.shortId || selectedWorkItem.workItem.session_id
  }`;

  const inlineProperties = (
    <WorkItemProperties
      workItem={selectedWorkItem.workItem}
      onUpdate={handleUpdateWorkItem}
      fieldVariant="pill"
      visibleFields={WORK_ITEM_PROPERTY_INLINE_FIELDS}
      showMoreMenu
    />
  );

  return (
    <div
      className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="chat-panel-work-item-detail"
    >
      <WorkItemContent
        key={workItemContentKey}
        workItem={selectedWorkItem.workItem}
        onUpdateWorkItem={handleUpdateWorkItem}
        onUpdateWorkItemImmediate={handleUpdateWorkItem}
        projectSlug={selectedWorkItem.projectSlug}
        shortId={selectedWorkItem.shortId}
        headerProperties={inlineProperties}
        onOpenSession={handleOpenSession}
        activeAgentSessionId={activeLinkedSession?.session_id ?? null}
      />
      {floatingSessionId && (
        <div
          className="absolute inset-x-3 bottom-3 top-16 z-30 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border-1 bg-chat-pane shadow-2xl"
          data-testid="work-item-floating-session-chat"
          data-session-id={floatingSessionId}
        >
          <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border-1 bg-bg-1/95 px-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-2">
              <ExternalLink size={14} className="shrink-0 text-text-3" />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-text-1">
                  {floatingSession?.result_preview ||
                    floatingSession?.sub_agent_name ||
                    floatingSession?.agent_role ||
                    t("common:terminology.session")}
                </div>
                <div className="truncate text-[11px] text-text-4">
                  {floatingSession?.status
                    ? `${floatingSession.status} · ${floatingSession.session_type}`
                    : floatingSessionId}
                </div>
              </div>
            </div>
            <Button
              variant="tertiary"
              appearance="ghost"
              shape="circle"
              size="small"
              onClick={handleCloseFloatingSession}
              aria-label="Close linked session chat"
              data-testid="work-item-floating-session-chat-close"
              icon={<X size={15} />}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChatView
              sessionId={floatingSessionId}
              secondary
              surfaceBgClass="bg-chat-pane"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkItemPanelView;
