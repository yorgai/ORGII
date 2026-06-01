import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import ModelIcon from "@src/components/ModelIcon";
import { resolveAgentIcon } from "@src/config/agentIcons";
import type { KanbanTask } from "@src/features/KanbanBoard";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
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

interface ListViewRowProps {
  task: KanbanTask;
  selected: boolean;
  onClick: (task: KanbanTask) => void;
}

const ListViewRow: React.FC<ListViewRowProps> = ({
  task,
  selected,
  onClick,
}) => {
  const { t, i18n } = useTranslation(["sessions", "common"]);
  const statusColor =
    KANBAN_COLUMN_COLOR_BY_ID.get(task.status) ?? "var(--color-fill-4)";
  const statusLabel = t(`sessions:${getColumnTitleKey(task.status)}`);
  const agentLabel = task.agentLabel || "—";
  const modelLabel = task.modelName ? formatModelNameFull(task.modelName) : "";
  const workspaceLabel = task.workspaceName || "—";
  const dateTimeLabelOptions = {
    todayLabel: t("common:relativeDate.today"),
    yesterdayLabel: t("common:relativeDate.yesterday"),
    locale: toIntlLocaleTag(i18n.resolvedLanguage),
  };
  const startedLabel = getTaskDateTimeLabel(
    task.created_at,
    dateTimeLabelOptions
  );
  const lastUpdatedLabel = getTaskDateTimeLabel(
    task.updated_at || task.completed_at || task.created_at,
    dateTimeLabelOptions
  );

  return (
    <button
      type="button"
      onClick={() => onClick(task)}
      className={`grid w-full grid-cols-[minmax(220px,1.45fr)_minmax(95px,0.55fr)_minmax(210px,1.05fr)_minmax(130px,0.7fr)_minmax(115px,0.6fr)_minmax(115px,0.6fr)] items-center gap-4 border-b border-border-2 px-5 py-2 text-left transition-colors hover:bg-fill-1 ${
        selected ? "bg-primary-1/50" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12px] font-medium text-text-1">
            {task.title}
          </span>
        </div>
        {task.description && (
          <div className="mt-0.5 truncate text-[11px] text-text-3">
            {task.description}
          </div>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 text-[12px] text-text-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: statusColor }}
        />
        <span className="truncate">{statusLabel}</span>
      </div>

      <div className="flex min-w-0 items-center gap-2 text-[12px] text-text-2">
        {renderAgentIcon(task)}
        <span className="min-w-0 truncate">{agentLabel}</span>
        {modelLabel && (
          <>
            <span className="shrink-0 text-text-4">·</span>
            <ModelIcon
              modelName={task.modelName}
              agentType={task.cliAgentType}
              size={14}
            />
            <span className="min-w-0 truncate">{modelLabel}</span>
          </>
        )}
      </div>

      <div className="truncate text-[12px] text-text-3" title={workspaceLabel}>
        {workspaceLabel}
      </div>

      <div className="truncate text-[12px] text-text-3">
        {startedLabel || "—"}
      </div>

      <div className="truncate text-[12px] text-text-3">
        {lastUpdatedLabel || "—"}
      </div>
    </button>
  );
};

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
  const { t } = useTranslation(["sessions", "common"]);
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => getTaskTimestamp(b) - getTaskTimestamp(a)),
    [tasks]
  );

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-10 scrollbar-hide">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(220px,1.45fr)_minmax(95px,0.55fr)_minmax(210px,1.05fr)_minmax(130px,0.7fr)_minmax(115px,0.6fr)_minmax(115px,0.6fr)] gap-4 border-b border-border-2 bg-[var(--cm-editor-background)] px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-text-3">
          <div>{t("common:labels.name")}</div>
          <div>{t("common:labels.status")}</div>
          <div>{t("sessions:kanban.list.agentModel")}</div>
          <div>{t("common:selectors.shared.workspace")}</div>
          <div>{t("sessions:kanban.list.started")}</div>
          <div>{t("sessions:kanban.list.lastUpdated")}</div>
        </div>

        {sortedTasks.length === 0 ? (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t("sessions:kanban.list.emptyTitle")}
            subtitle={t("sessions:kanban.list.emptyDescription")}
          />
        ) : (
          <div>
            {sortedTasks.map((task) => (
              <ListViewRow
                key={task.id}
                task={task}
                selected={task.id === selectedTaskId && detailPanelVisible}
                onClick={onTaskClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ListView;
