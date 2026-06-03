import { emit } from "@tauri-apps/api/event";
import { useSetAtom } from "jotai";
import React, { useCallback } from "react";

import {
  type WorkItemPartialUpdate,
  enrichedWorkItemToUI,
  projectApi,
} from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import {
  WorkItemContent,
  WorkItemProperties,
} from "@src/modules/ProjectManager/WorkItems/components";
import { WORK_ITEM_PROPERTY_ESSENTIAL_FIELDS } from "@src/modules/ProjectManager/WorkItems/components/WorkItemProperties";
import {
  type ChatPanelSelectedWorkItem,
  chatPanelSelectedWorkItemAtom,
} from "@src/store/ui/chatPanelAtom";
import type { WorkItem } from "@src/types/core/workItem";

const logger = createLogger("WorkItemPanelView");

interface WorkItemPanelViewProps {
  selectedWorkItem: ChatPanelSelectedWorkItem;
  onUpdateWorkItem?: (updates: Partial<WorkItem>) => void;
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
  const setSelectedWorkItem = useSetAtom(chatPanelSelectedWorkItemAtom);

  const handleUpdateWorkItem = useCallback(
    async (updates: Partial<WorkItem>) => {
      if (onUpdateWorkItem) {
        onUpdateWorkItem(updates);
        return;
      }

      try {
        const payload = toWorkItemPartialUpdate(updates);
        if (Object.keys(payload).length === 0) return;

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
        await emit("orgii-data-changed");
      } catch (error) {
        logger.error("Failed to update chat panel work item", error);
      }
    },
    [onUpdateWorkItem, selectedWorkItem, setSelectedWorkItem]
  );

  const workItemContentKey = `${selectedWorkItem.projectSlug}:${
    selectedWorkItem.shortId || selectedWorkItem.workItem.session_id
  }`;

  const inlineProperties = (
    <WorkItemProperties
      workItem={selectedWorkItem.workItem}
      onUpdate={handleUpdateWorkItem}
      fieldVariant="pill"
      visibleFields={WORK_ITEM_PROPERTY_ESSENTIAL_FIELDS}
      showMoreMenu
    />
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <WorkItemContent
        key={workItemContentKey}
        workItem={selectedWorkItem.workItem}
        onUpdateWorkItem={handleUpdateWorkItem}
        onUpdateWorkItemImmediate={handleUpdateWorkItem}
        projectSlug={selectedWorkItem.projectSlug}
        shortId={selectedWorkItem.shortId}
        headerProperties={inlineProperties}
        hideTitleHeader
        showHeaderPropertiesWhenTitleHidden
      />
    </div>
  );
};

export default WorkItemPanelView;
