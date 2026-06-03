/**
 * PlanTodoPinBar — pinned todo progress bar in the sticky group header.
 *
 * Renders whenever todos exist.
 * Collapsed: label + "X/Y" progress counter.
 * Expanded: individual todo rows with status icons.
 */
import { useAtomValue } from "jotai";
import { Check, ChevronRight, ListTodo, Lock } from "lucide-react";
import React, { memo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  COMPOSER_STACK_ROW_BASE,
  COMPOSER_STACK_ROW_LABEL,
} from "@src/config/composerStackTokens";
import { isSessionActiveAtom } from "@src/store/session/cliSessionStatusAtom";
import { getTodoBatchTitle, todosAtom } from "@src/store/ui/todoAtom";

import ComposerStackHeader, {
  ComposerStackHeaderCountBadge,
} from "./ComposerStackHeader";

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
// Main component
// ============================================

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

function todoRowKey(todoId: string, index: number): string {
  return `plan-todo:${todoId || "missing"}:${index}`;
}

const PlanTodoPinBar: React.FC = memo(() => {
  const { t } = useTranslation("sessions");
  const todos = useAtomValue(todosAtom);
  const isAgentWorking = useAtomValue(isSessionActiveAtom);
  const [expanded, setExpanded] = useState(false);

  if (todos.length === 0) return null;

  const completedCount = todos.filter((t) =>
    t.status.toLowerCase().includes("completed")
  ).length;

  const allDone =
    !isAgentWorking &&
    todos.every((todo) => TERMINAL_STATUSES.has(todo.status.toLowerCase()));
  if (allDone) return null;

  const progressBadge = (
    <ComposerStackHeaderCountBadge>
      {completedCount}/{todos.length}
    </ComposerStackHeaderCountBadge>
  );

  const iconSlot = <ListTodo size={13} strokeWidth={1.75} />;

  const label = getTodoBatchTitle(todos) || t("planner.todoList.title");

  return (
    <div data-testid="plan-todo-pin-bar">
      <ComposerStackHeader
        label={label}
        icon={iconSlot}
        expanded={expanded}
        onToggle={() => setExpanded((prev) => !prev)}
        badges={progressBadge}
        labelVariant="strong"
      />

      {expanded && (
        <div className="px-1 pb-1">
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
                className={`${COMPOSER_STACK_ROW_BASE} ${blocked ? "opacity-50" : ""}`}
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
});

PlanTodoPinBar.displayName = "PlanTodoPinBar";

export default PlanTodoPinBar;
