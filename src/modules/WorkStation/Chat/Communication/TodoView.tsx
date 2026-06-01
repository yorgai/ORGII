/**
 * TodoView Component
 *
 * Renders a todo/task list extracted from a message event.
 * Shows task items with status checkboxes and a summary header.
 */
import { Check } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { extractTodoData } from "@src/engines/SessionCore/rendering/props";
import { normalizeActivity } from "@src/lib/activityData";

import type { MessageEntry } from "./types";

// ============================================
// Task Checkbox
// ============================================

const TaskCheckbox: React.FC<{ status: string }> = ({ status }) => {
  const normalized = (status || "").toLowerCase();
  const isCompleted =
    normalized.includes("completed") || normalized === "completed";
  const isInProgress =
    normalized.includes("progress") || normalized === "in_progress";

  return (
    <div className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
      {isCompleted ? (
        <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success-6">
          <Check size={8} strokeWidth={3} className="text-white" />
        </div>
      ) : isInProgress ? (
        <div className="h-3.5 w-3.5 rounded-full border-2 border-primary-6 bg-primary-1" />
      ) : (
        <div className="h-3.5 w-3.5 rounded-full border-2 border-border-3" />
      )}
    </div>
  );
};

// ============================================
// Helpers
// ============================================

interface StatusCounts {
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

function getTaskClasses(status: string): string {
  const normalized = (status || "").toLowerCase();
  if (normalized.includes("completed") || normalized === "completed") {
    return "text-success-6";
  }
  if (normalized.includes("cancelled") || normalized === "cancelled") {
    return "text-text-3 line-through";
  }
  return "text-text-1";
}

// ============================================
// TodoView (Main Export)
// ============================================

export const TodoView: React.FC<{
  message: MessageEntry;
  className?: string;
}> = ({ message, className = "p-6" }) => {
  const { t } = useTranslation("sessions");

  // Extract todos using the same normalizer as chat panel
  const todos = useMemo(() => {
    const normalized = normalizeActivity(
      message.event as unknown as Record<string, unknown>
    );

    const todoData = extractTodoData({
      eventId: message.eventId,
      eventType: "manage_todo",
      args: normalized.args,
      result: normalized.result,
      status: "success" as const,
      variant: "simulator" as const,
      context: "simulator" as const,
    });

    return todoData.todos;
  }, [message.event, message.eventId]);

  // Count by status
  const statusCounts = useMemo((): StatusCounts => {
    return todos.reduce<StatusCounts>(
      (acc, todo) => {
        const status = (todo.status || "").toLowerCase();
        if (status.includes("progress") || status === "in_progress") {
          acc.inProgress++;
        } else if (status.includes("completed") || status === "completed") {
          acc.completed++;
        } else if (status.includes("cancelled") || status === "cancelled") {
          acc.cancelled++;
        } else {
          acc.pending++;
        }
        return acc;
      },
      { pending: 0, inProgress: 0, completed: 0, cancelled: 0 }
    );
  }, [todos]);

  // Build summary
  const summary = useMemo(() => {
    const parts: string[] = [];
    if (statusCounts.inProgress > 0) {
      parts.push(
        t("simulator.replay.messages.todo.summaryActive", {
          count: statusCounts.inProgress,
        })
      );
    }
    if (statusCounts.completed > 0) {
      parts.push(
        t("simulator.replay.messages.todo.summaryDone", {
          count: statusCounts.completed,
        })
      );
    }
    if (statusCounts.pending > 0) {
      parts.push(
        t("simulator.replay.messages.todo.summaryPending", {
          count: statusCounts.pending,
        })
      );
    }
    if (statusCounts.cancelled > 0) {
      parts.push(
        t("simulator.replay.messages.todo.summaryCancelled", {
          count: statusCounts.cancelled,
        })
      );
    }
    return (
      parts.join(" · ") ||
      t("simulator.replay.messages.todo.summaryItemsOnly", {
        count: todos.length,
      })
    );
  }, [statusCounts, t, todos.length]);

  return (
    <div className={className}>
      <div className="mb-2 text-[12px] leading-relaxed text-text-2">
        {summary}
      </div>

      <div className="flex flex-col gap-1.5">
        {todos.map((todo, index) => (
          <div key={todo.id || index} className="flex items-center gap-2">
            <TaskCheckbox status={todo.status} />
            <span
              className={`flex-1 text-[12px] leading-relaxed ${getTaskClasses(todo.status)}`}
            >
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
