import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  Clock,
  Minus,
  XCircle,
} from "lucide-react";
import React from "react";

import type {
  WorkItemCardData,
  WorkItemPriority,
  WorkItemStatus,
} from "../types";

interface StatusConfig {
  icon: React.ReactNode;
  label: string;
  className: string;
}

function getStatusConfig(status: WorkItemStatus | string): StatusConfig {
  switch (status) {
    case "todo":
      return {
        icon: <Circle size={12} />,
        label: "Todo",
        className: "text-text-4",
      };
    case "in_progress":
      return {
        icon: <Clock size={12} />,
        label: "In Progress",
        className: "text-primary-6",
      };
    case "in_review":
      return {
        icon: <AlertCircle size={12} />,
        label: "In Review",
        className: "text-warning-6",
      };
    case "done":
      return {
        icon: <CheckCircle2 size={12} />,
        label: "Done",
        className: "text-success-6",
      };
    case "cancelled":
      return {
        icon: <XCircle size={12} />,
        label: "Cancelled",
        className: "text-text-4",
      };
    case "backlog":
      return {
        icon: <Circle size={12} className="opacity-40" />,
        label: "Backlog",
        className: "text-text-4",
      };
    default:
      return {
        icon: <Circle size={12} />,
        label: String(status),
        className: "text-text-4",
      };
  }
}

interface PriorityConfig {
  icon: React.ReactNode;
  label: string;
  className: string;
}

function getPriorityConfig(
  priority: WorkItemPriority | string
): PriorityConfig {
  switch (priority) {
    case "urgent":
      return {
        icon: <AlertCircle size={11} />,
        label: "Urgent",
        className: "text-danger-6",
      };
    case "high":
      return {
        icon: <ArrowUp size={11} />,
        label: "High",
        className: "text-warning-6",
      };
    case "medium":
      return {
        icon: <Minus size={11} />,
        label: "Medium",
        className: "text-text-3",
      };
    case "low":
      return {
        icon: <ArrowDown size={11} />,
        label: "Low",
        className: "text-text-4",
      };
    default:
      return { icon: null, label: String(priority), className: "text-text-4" };
  }
}

interface WorkItemCardProps {
  card: WorkItemCardData;
}

const WorkItemCard: React.FC<WorkItemCardProps> = ({ card }) => {
  const statusConfig = getStatusConfig(card.status);
  const priorityConfig = card.priority
    ? getPriorityConfig(card.priority)
    : null;

  return (
    <div className="mx-3 my-2 rounded-lg border border-fill-4 bg-fill-2 px-3 py-2.5 transition-colors hover:bg-fill-3">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 ${statusConfig.className}`}>
          {statusConfig.icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="chat-block-content truncate font-medium text-text-1">
              {card.title}
            </span>
            {priorityConfig && (
              <span
                className={`shrink-0 ${priorityConfig.className}`}
                title={priorityConfig.label}
              >
                {priorityConfig.icon}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-4">
            <span
              className={`inline-flex items-center gap-1 ${statusConfig.className}`}
            >
              {statusConfig.label}
            </span>
            {card.shortId && (
              <>
                <span>·</span>
                <span className="shrink-0">{card.shortId}</span>
              </>
            )}
            {card.projectName && (
              <>
                <span>·</span>
                <span className="truncate">{card.projectName}</span>
              </>
            )}
            {card.assignee && (
              <>
                <span>·</span>
                <span className="shrink-0">{card.assignee}</span>
              </>
            )}
            {card.dueDate && (
              <>
                <span>·</span>
                <span className="shrink-0">Due {card.dueDate}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

WorkItemCard.displayName = "WorkItemCard";

export default WorkItemCard;
