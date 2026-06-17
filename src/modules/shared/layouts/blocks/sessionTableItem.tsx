import React from "react";

import ModelIcon from "@src/components/ModelIcon";
import { resolveAgentIcon } from "@src/config/agentIcons";
import type { KanbanTask } from "@src/features/KanbanBoard";
import TaskImpactLine from "@src/features/KanbanBoard/components/TaskImpactLine";
import { KANBAN_RESULT_STATUS } from "@src/features/KanbanBoard/types";
import { formatSmartDateTime } from "@src/util/data/formatters/date";
import { formatModelNameFull } from "@src/util/formatModelName";

import type { SessionTableItem } from "./SessionTable";

export interface SessionTableDateTimeLabelOptions {
  todayLabel?: string;
  yesterdayLabel?: string;
  locale?: string;
}

interface MapKanbanTaskToSessionTableItemInput {
  task: KanbanTask;
  statusLabel: React.ReactNode;
  dateTimeLabelOptions?: SessionTableDateTimeLabelOptions;
  active?: boolean;
  testId?: string;
}

function renderAgentIcon(task: KanbanTask): React.ReactNode {
  if (task.cliAgentType) {
    return <ModelIcon agentType={task.cliAgentType} size={14} />;
  }

  if (task.agentIconId === "cursor") {
    return <ModelIcon agentType="cursor_cli" size={14} />;
  }

  const AgentIcon = resolveAgentIcon(task.agentIconId);
  return <AgentIcon size={14} strokeWidth={1.75} className="text-text-3" />;
}

function getStatusColor(task: KanbanTask): string | undefined {
  switch (task.resultStatus) {
    case KANBAN_RESULT_STATUS.Failed:
      return "var(--color-danger-6)";
    case KANBAN_RESULT_STATUS.Archived:
      return "var(--color-text-3)";
    default:
      return undefined;
  }
}

function formatDateTimeLabel(
  dateString: string | undefined,
  options: SessionTableDateTimeLabelOptions | undefined
): string | undefined {
  if (!dateString) return undefined;
  return formatSmartDateTime(dateString, {
    yesterdayLabel: options?.yesterdayLabel,
    locale: options?.locale,
  });
}

export function mapKanbanTaskToSessionTableItem({
  task,
  statusLabel,
  dateTimeLabelOptions,
  active,
  testId,
}: MapKanbanTaskToSessionTableItemInput): SessionTableItem {
  const orgtrackMetadata = task.orgtrackMetadata;
  const committedRateValue = orgtrackMetadata?.committedRatePercent;

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    statusLabel,
    statusColor: getStatusColor(task),
    agentIcon: renderAgentIcon(task),
    agentLabel: task.agentLabel ?? task.assignee,
    modelIcon: task.modelName ? (
      <ModelIcon
        modelName={task.modelName}
        agentType={task.cliAgentType}
        size={14}
      />
    ) : undefined,
    modelLabel: task.modelName
      ? formatModelNameFull(task.modelName)
      : undefined,
    workspaceLabel: task.workspaceName,
    workspaceTitle: task.workspaceName,
    impactLabel: <TaskImpactLine task={task} showUnavailable={false} />,
    filesChangedLabel:
      orgtrackMetadata && orgtrackMetadata.filesChanged > 0
        ? orgtrackMetadata.filesChanged.toLocaleString()
        : undefined,
    relatedCommitsLabel:
      orgtrackMetadata && orgtrackMetadata.relatedCommits > 0
        ? orgtrackMetadata.relatedCommits.toLocaleString()
        : undefined,
    committedRateLabel:
      committedRateValue !== undefined ? `${committedRateValue}%` : undefined,
    committedRateValue,
    startedLabel: formatDateTimeLabel(task.created_at, dateTimeLabelOptions),
    lastUpdatedLabel: formatDateTimeLabel(
      task.updated_at ?? task.completed_at,
      dateTimeLabelOptions
    ),
    active,
    testId,
  };
}
