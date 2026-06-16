/**
 * TaskCard Component
 *
 * Individual task card displayed in Kanban columns.
 * Shows task information with priority, tags, and metadata.
 */
import {
  ChevronRight,
  CircleSlash,
  Diff,
  GitCommit,
  LoaderCircle,
  MessagesSquare,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import ModelIcon from "@src/components/ModelIcon";
import Tag from "@src/components/Tag";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { formatModelNameFull } from "@src/util/formatModelName";

import { type KanbanTask } from "../../types";
import { PriorityIndicator } from "../../utils/priority";
import "./index.scss";

export interface TaskCardProps {
  task: KanbanTask;
  onClick?: (task: KanbanTask) => void;
  isDragging?: boolean;
  /**
   * True when this card backs the currently-open session preview. Adds
   * a primary-6 accent so the source of the floating panel is obvious.
   */
  isSelected?: boolean;
}

function renderAgentIcon(task: KanbanTask) {
  if (task.cliAgentType) {
    return <ModelIcon agentType={task.cliAgentType} size={12} />;
  }

  // Cursor IDE history sessions don't carry a `cliAgentType` (they're not
  // launched through our CLI dispatch) but they stamp `agentIconId: "cursor"`
  // in the session loader. Route them through `ModelIcon` so the brand mark
  // matches the Session Creator's hero icon (themeable `text-text-1`) instead
  // of the dim `text-text-3` brand wrapper used for generic Lucide icons.
  if (task.agentIconId === "cursor") {
    return <ModelIcon agentType="cursor_cli" size={12} />;
  }

  const AgentIcon = resolveAgentIcon(task.agentIconId);
  return <AgentIcon size={12} strokeWidth={1.75} className="text-text-3" />;
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onClick,
  isDragging,
  isSelected = false,
}) => {
  const { t } = useTranslation("common");
  const handleClick = () => {
    onClick?.(task);
  };
  const handleRefreshGitBlame = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    const refresh = task.onAnalyzeGitBlame ?? task.onUpdateGitBlame;
    void refresh?.(task);
  };

  const isInteractive = Boolean(onClick);
  const hasOrgtrackImpactMetadata = Boolean(
    task.orgtrackMetadata &&
    (task.orgtrackMetadata.filesChanged > 0 ||
      task.orgtrackMetadata.linesAdded > 0 ||
      task.orgtrackMetadata.linesRemoved > 0 ||
      task.orgtrackMetadata.relatedCommits > 0 ||
      task.orgtrackMetadata.committedRatePercent > 0)
  );
  const relatedCommits = task.orgtrackMetadata?.relatedCommits ?? 0;
  const hasRelatedCommits = relatedCommits > 0;
  const cardClasses = [
    "kanban-task-card",
    isInteractive && "kanban-task-card--interactive",
    isDragging && "kanban-task-card--dragging",
    isSelected && "kanban-task-card--selected",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cardClasses}
      data-testid={`kanban-task-card-${task.id}`}
      onClick={handleClick}
    >
      {/* Owning Agent Org (only set on the global Ops Control board) */}
      {task.orgName && (
        <div className="kanban-task-card__chat-tag">
          <MessagesSquare size={12} strokeWidth={1.75} />
          <span>{task.orgName}</span>
        </div>
      )}

      {/* Header */}
      <div className="kanban-task-card__header">
        <div className="kanban-task-card__title">{task.title}</div>
        {task.attempt_count && task.attempt_count > 1 && (
          <div className="kanban-task-card__header-badges">
            <div className="kanban-task-card__badge">
              Retry {task.attempt_count - 1}
            </div>
          </div>
        )}
      </div>

      {/* Description */}
      {task.description && (
        <div className="kanban-task-card__description">{task.description}</div>
      )}

      {/* Labels */}
      {task.labels && task.labels.length > 0 && (
        <div className="kanban-task-card__tags">
          {task.labels.slice(0, 3).map((label) => (
            <Tag key={label.id} size="mini" color={label.color} pill>
              {label.name}
            </Tag>
          ))}
          {task.labels.length > 3 && (
            <span className="kanban-task-card__tag-more">
              +{task.labels.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="kanban-task-card__footer">
        <div className="kanban-task-card__footer-left">
          <div className="kanban-task-card__impact-line">
            {hasOrgtrackImpactMetadata && task.orgtrackMetadata ? (
              <>
                <span className="kanban-task-card__impact-diff">
                  <span className="text-success-6">
                    +{task.orgtrackMetadata.linesAdded.toLocaleString()}
                  </span>
                  <span className="text-danger-6">
                    -{task.orgtrackMetadata.linesRemoved.toLocaleString()}
                  </span>
                </span>
                <span className="kanban-task-card__impact-dot" />
                <span className="kanban-task-card__impact-item">
                  <Diff size={12} strokeWidth={1.75} />
                  <span>
                    {task.orgtrackMetadata.filesChanged.toLocaleString()}
                  </span>
                </span>
                {hasRelatedCommits && (
                  <>
                    <span className="kanban-task-card__impact-dot" />
                    <span className="kanban-task-card__impact-item text-primary-6">
                      <GitCommit
                        className="kanban-task-card__commit-icon"
                        size={12}
                        strokeWidth={1.75}
                      />
                      <span>{relatedCommits.toLocaleString()}</span>
                    </span>
                  </>
                )}
              </>
            ) : task.orgtrackMetadataLoading ? (
              <span className="kanban-task-card__impact-loading">
                <LoaderCircle size={12} strokeWidth={1.75} />
                <span>{t("loading")}</span>
              </span>
            ) : task.onAnalyzeGitBlame || task.onUpdateGitBlame ? (
              <button
                className="kanban-task-card__impact-action"
                type="button"
                title={t("actions.refresh")}
                onClick={handleRefreshGitBlame}
              >
                <CircleSlash size={12} strokeWidth={1.75} />
                <span>N/A</span>
              </button>
            ) : (
              <span className="kanban-task-card__impact-empty">
                <CircleSlash size={12} strokeWidth={1.75} />
                <span>N/A</span>
              </span>
            )}
          </div>
          <div className="kanban-task-card__meta-row">
            <PriorityIndicator priority={task.priority} />
            {task.agentLabel && (
              <div className="kanban-task-card__meta-pill">
                {renderAgentIcon(task)}
                <span>{task.agentLabel}</span>
              </div>
            )}
            {task.agentLabel && task.modelName && (
              <span className="kanban-task-card__impact-dot" />
            )}
            {task.modelName && (
              <div className="kanban-task-card__meta-pill">
                <ModelIcon
                  modelName={task.modelName}
                  agentType={task.cliAgentType}
                  size={12}
                />
                <span>{formatModelNameFull(task.modelName)}</span>
              </div>
            )}
            {task.metaLines?.map((entry, idx) => {
              const Icon = entry.icon;
              return (
                <div
                  key={idx}
                  className="kanban-task-card__meta-pill"
                  style={entry.color ? { color: entry.color } : undefined}
                >
                  {Icon && <Icon size={12} strokeWidth={1.75} />}
                  <span>{entry.text}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* Chevron is purely an affordance for "click to open detail" —
         * only render it when there's actually an onClick handler.
         * TodoKanban renders the same card read-only, so the chevron
         * would be misleading there. */}
        {onClick && (
          <div className="kanban-task-card__footer-right">
            <ChevronRight size={14} className="text-text-3" />
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskCard;
