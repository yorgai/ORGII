import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import ModelIcon from "@src/components/ModelIcon";
import { resolveAgentIcon } from "@src/config/agentIcons";
import type { KanbanTask } from "@src/features/KanbanBoard";
import {
  Placeholder,
  SessionTable,
  type SessionTableItem,
} from "@src/modules/shared/layouts/blocks";
import {
  formatReplayDateLabel,
  toIntlLocaleTag,
} from "@src/util/data/formatters/date";
import { formatModelNameFull } from "@src/util/formatModelName";

import { KANBAN_COLUMNS, getColumnTitleKey } from "../../config";

const KANBAN_COLUMN_COLOR_BY_ID = new Map(
  KANBAN_COLUMNS.map((column) => [column.id, column.color])
);

function getTaskTimestamp(task: KanbanTask): number {
  const timestamp = task.updated_at || task.created_at;
  if (!timestamp) return 0;
  return new Date(timestamp).getTime();
}

interface TaskDateTimeLabelOptions {
  todayLabel: string;
  yesterdayLabel: string;
  locale: string;
}

function getTaskDateTimeLabel(
  timestamp: string | undefined,
  options: TaskDateTimeLabelOptions
): string {
  return formatReplayDateLabel(timestamp, {
    todayLabel: options.todayLabel,
    yesterdayLabel: options.yesterdayLabel,
    locale: options.locale,
    withSeconds: false,
    monthStyle: "short",
  });
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

function taskToSessionTableItem(
  task: KanbanTask,
  selected: boolean,
  statusLabel: React.ReactNode,
  dateTimeLabelOptions: TaskDateTimeLabelOptions
): SessionTableItem {
  const modelLabel = task.modelName ? formatModelNameFull(task.modelName) : "";
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    statusLabel,
    statusColor: KANBAN_COLUMN_COLOR_BY_ID.get(task.status),
    agentIcon: renderAgentIcon(task),
    agentLabel: task.agentLabel || undefined,
    modelIcon: task.modelName ? (
      <ModelIcon
        modelName={task.modelName}
        agentType={task.cliAgentType}
        size={14}
      />
    ) : undefined,
    modelLabel,
    workspaceLabel: task.workspaceName,
    workspaceTitle: task.workspaceName,
    startedLabel: getTaskDateTimeLabel(task.created_at, dateTimeLabelOptions),
    lastUpdatedLabel: getTaskDateTimeLabel(
      task.updated_at || task.completed_at || task.created_at,
      dateTimeLabelOptions
    ),
    active: selected,
  };
}

export interface ListViewProps {
  tasks: KanbanTask[];
  selectedTaskId: string | null;
  detailPanelVisible: boolean;
  onTaskClick: (task: KanbanTask) => void;
}

const ListView: React.FC<ListViewProps> = ({
  tasks,
  selectedTaskId,
  detailPanelVisible,
  onTaskClick,
}) => {
  const { t, i18n } = useTranslation(["sessions", "common"]);
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => getTaskTimestamp(b) - getTaskTimestamp(a)),
    [tasks]
  );
  const dateTimeLabelOptions = useMemo(
    () => ({
      todayLabel: t("common:relativeDate.today"),
      yesterdayLabel: t("common:relativeDate.yesterday"),
      locale: toIntlLocaleTag(i18n.resolvedLanguage),
    }),
    [i18n.resolvedLanguage, t]
  );
  const sessionTableItems = useMemo(
    () =>
      sortedTasks.map((task) =>
        taskToSessionTableItem(
          task,
          task.id === selectedTaskId && detailPanelVisible,
          t(`sessions:${getColumnTitleKey(task.status)}`),
          dateTimeLabelOptions
        )
      ),
    [dateTimeLabelOptions, detailPanelVisible, selectedTaskId, sortedTasks, t]
  );

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {sortedTasks.length === 0 ? (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("sessions:kanban.list.emptyTitle")}
          subtitle={t("sessions:kanban.list.emptyDescription")}
        />
      ) : (
        <SessionTable
          items={sessionTableItems}
          onSelect={(item) => {
            const task = sortedTasks.find(
              (candidate) => candidate.id === item.id
            );
            if (task) {
              onTaskClick(task);
            }
          }}
          className="pb-10"
        />
      )}
    </div>
  );
};

export default ListView;
