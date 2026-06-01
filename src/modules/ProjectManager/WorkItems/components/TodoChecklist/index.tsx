import React from "react";
import { useTranslation } from "react-i18next";

import TodoChecklist from "@src/components/TodoChecklist";
import type { TodoItem } from "@src/types/core/workItem";

interface WorkItemTodoChecklistProps {
  todos: TodoItem[];
  onChange: (todos: TodoItem[]) => void;
  disabled?: boolean;
}

const WorkItemTodoChecklist: React.FC<WorkItemTodoChecklistProps> = ({
  todos,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation("projects");

  return (
    <TodoChecklist
      items={todos}
      onChange={onChange}
      title={t("workItems.todos.title")}
      placeholder={t("workItems.todos.placeholder")}
      doneLabel={t("workItems.todos.done")}
      createLabel={t("workItems.todos.create")}
      disabled={disabled}
      className="mb-4"
    />
  );
};

export default WorkItemTodoChecklist;
