/**
 * SubagentTodoPinBar — compact todo progress bar pinned inside a
 * SubagentBlock, visually attached below the PinnedPrompt (matching
 * how PlanTodoPinBar attaches below UserChatItem in the main session).
 *
 * The source of truth is the subagent's own nested event stream; we
 * derive the latest `manage_todo` snapshot client-side so the bar never
 * leaks todos from the parent session (or from another subagent).
 * That means no writes to `sessionTodoMapAtom` happen here — the parent
 * session's PlanTodoPinBar stays bound to its own slot.
 */
import { Check, ChevronRight, Lock, Settings2 } from "lucide-react";
import React, { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  COMPOSER_STACK_ROW_BASE,
  COMPOSER_STACK_ROW_HOVER,
  COMPOSER_STACK_ROW_LABEL,
} from "@src/config/composerStackTokens";
import ComposerStackHeader, {
  ComposerStackHeaderCountBadge,
} from "@src/engines/ChatPanel/InputArea/components/ComposerStackHeader";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { extractTodoData } from "@src/engines/SessionCore/rendering/props";
import { normalizeActivity } from "@src/lib/activityData";
import { isTodoEvent } from "@src/modules/WorkStation/Chat/Communication/utils";
import { type TodoItem, getTodoBatchTitle } from "@src/store/ui/todoAtom";

// ============================================
// Helpers
// ============================================

function isManageTodoEvent(event: SessionEvent): boolean {
  const fn = event.functionName || "";
  const actionType = event.actionType || "";
  if (fn && isTodoEvent(fn)) return true;
  if (actionType && isTodoEvent(actionType)) return true;
  return false;
}

function todoRowKey(todoId: string, index: number): string {
  return `subagent-todo:${todoId || "missing"}:${index}`;
}

function extractTodosFromEvent(event: SessionEvent): TodoItem[] {
  const normalized = normalizeActivity(
    event as unknown as Record<string, unknown>
  );
  const todoData = extractTodoData({
    eventId: event.id,
    eventType: "manage_todo",
    args: normalized.args,
    result: normalized.result,
    status: "success" as const,
    variant: "chat" as const,
    context: "chat" as const,
  });
  return todoData.todos.map((todo) => {
    const raw = todo as unknown as Record<string, unknown>;
    const activeForm =
      typeof raw.activeForm === "string" && raw.activeForm.length > 0
        ? (raw.activeForm as string)
        : undefined;
    const blockedBy = Array.isArray(raw.blockedBy)
      ? (raw.blockedBy as number[])
      : todo.blockedBy;
    return {
      id: todo.id || crypto.randomUUID(),
      content: todo.content || "",
      activeForm,
      status: (todo.status || "pending") as TodoItem["status"],
      ...(blockedBy && blockedBy.length > 0 ? { blockedBy } : {}),
    };
  });
}

export function deriveLatestTodos(events: SessionEvent[]): TodoItem[] {
  for (let idx = events.length - 1; idx >= 0; idx--) {
    if (isManageTodoEvent(events[idx])) {
      return extractTodosFromEvent(events[idx]);
    }
  }
  return [];
}

// ============================================
// Status icon
// ============================================

const TodoStatusIcon: React.FC<{ status: string; blocked?: boolean }> = ({
  status,
  blocked,
}) => {
  const norm = status.toLowerCase();
  if (norm === "completed") {
    return (
      <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-green-600/80">
        <Check size={8} strokeWidth={3} className="text-white" />
      </div>
    );
  }
  if (norm === "in_progress") {
    return (
      <ChevronRight
        size={14}
        strokeWidth={2}
        className="shrink-0 text-primary-6"
      />
    );
  }
  if (blocked) {
    return (
      <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-text-3/40">
        <Lock size={6} strokeWidth={2.5} className="text-text-3/60" />
      </div>
    );
  }
  return (
    <div className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-text-3/50" />
  );
};

// ============================================
// Component
// ============================================

interface SubagentTodoPinBarProps {
  events: SessionEvent[];
  /** When true, the bar visually attaches below another element (no top border, rounded-b only). */
  attached?: boolean;
}

const SubagentTodoPinBar: React.FC<SubagentTodoPinBarProps> = memo(
  ({ events, attached = false }) => {
    const { t } = useTranslation("sessions");
    const [expanded, setExpanded] = useState(false);

    const todos = useMemo(() => deriveLatestTodos(events), [events]);

    if (todos.length === 0) return null;

    const completedCount = todos.filter((todo) =>
      todo.status.toLowerCase().includes("completed")
    ).length;

    const progressBadge = (
      <ComposerStackHeaderCountBadge>
        {completedCount}/{todos.length}
      </ComposerStackHeaderCountBadge>
    );

    const iconSlot = (
      <Settings2 size={13} strokeWidth={1.75} className="text-text-3" />
    );
    const label = getTodoBatchTitle(todos) || t("planner.todoList.title");

    const containerClass = attached
      ? "-mt-px rounded-b-lg border-x border-b border-solid border-border-2 bg-bg-2"
      : "rounded-lg border border-solid border-border-2 bg-bg-2";

    return (
      <div className={containerClass}>
        <ComposerStackHeader
          label={label}
          icon={iconSlot}
          expanded={expanded}
          onToggle={() => setExpanded((prev) => !prev)}
          badges={progressBadge}
        />

        {expanded && (
          <div className="px-2 pb-1.5">
            {todos.map((todo, idx) => {
              const done = todo.status.toLowerCase().includes("completed");
              const blocked =
                !done &&
                todo.blockedBy != null &&
                todo.blockedBy.length > 0 &&
                todo.blockedBy.some((blockerIdx) => {
                  const blocker = todos[blockerIdx];
                  return (
                    blocker != null &&
                    !blocker.status.toLowerCase().includes("completed")
                  );
                });
              return (
                <div
                  key={todoRowKey(todo.id, idx)}
                  className={`${COMPOSER_STACK_ROW_BASE} ${COMPOSER_STACK_ROW_HOVER} ${blocked ? "opacity-50" : ""}`}
                >
                  <TodoStatusIcon status={todo.status} blocked={blocked} />
                  <span
                    className={`${COMPOSER_STACK_ROW_LABEL} ${done ? "!text-text-3 line-through" : ""}`}
                  >
                    {todo.content}
                  </span>
                  {blocked && todo.blockedBy && (
                    <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] text-text-3/70">
                      <Lock size={8} strokeWidth={2} />
                      {todo.blockedBy.map((bi) => `#${bi}`).join(", ")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
);

SubagentTodoPinBar.displayName = "SubagentTodoPinBar";

export default SubagentTodoPinBar;
