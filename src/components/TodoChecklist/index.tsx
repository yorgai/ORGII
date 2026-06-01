import { Plus, Trash2 } from "lucide-react";
import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Checkbox from "@src/components/Checkbox";
import Input from "@src/components/Input";

const MAX_TODO_LENGTH = 120;
const SINGLE_LINE_PX = 30;

function todoTextHasLineBreak(text: string): boolean {
  return /[\r\n]/.test(text);
}

/** Flush Input inside todo row: strip wrapper chrome from design-system Input */
const TODO_LINE_INPUT_WRAPPER_CLASS =
  "h-[30px] min-h-0 border-none bg-transparent shadow-none [&_.input-inner]:h-[30px] [&_.input-inner]:min-h-0 [&_.input-inner]:rounded-none [&_.input-inner]:border-none [&_.input-inner]:bg-transparent [&_.input-inner]:p-0 [&_.input-inner]:shadow-none [&.input-focused_.input-inner]:border-transparent [&.input-focused_.input-inner]:shadow-none";
const TODO_LINE_INPUT_FIELD_CLASS =
  "text-[13px] leading-[30px] text-text-1 placeholder:text-text-3";

export interface TodoChecklistItem {
  id: string;
  content: string;
  /** "pending" | "completed" */
  status: string;
}

export interface TodoChecklistProps {
  items: TodoChecklistItem[];
  onChange: (items: TodoChecklistItem[]) => void;
  /** Placeholder text for empty / new items */
  placeholder?: string;
  /** Section title */
  title?: string;
  /** Label for "done" count */
  doneLabel?: string;
  /** Label for create button */
  createLabel?: string;
  disabled?: boolean;
  /** Hide the built-in header (count + create button) */
  hideHeader?: boolean;
  className?: string;
  /** When true, used inside a fill-2 container — hover uses bg-2 instead of fill-2 */
  containerFill2?: boolean;
}

const ROW_TEXT_CLASS = "text-[13px] leading-[30px]";

const TodoChecklist: React.FC<TodoChecklistProps> = ({
  items,
  onChange,
  placeholder = "Add a to-do",
  title = "To-Do",
  doneLabel = "Done",
  createLabel = "Create",
  disabled = false,
  hideHeader = false,
  className = "",
  containerFill2 = false,
}) => {
  const rowHoverClass = containerFill2 ? "hover:bg-bg-2" : "hover:bg-fill-2";
  const [selectedEditingId, setEditingId] = useState<string | null>(null);

  const editingId = useMemo(() => {
    if (disabled || selectedEditingId) return selectedEditingId;
    const emptyItem = items.find((item) => item.content.trim().length === 0);
    return emptyItem?.id ?? null;
  }, [items, selectedEditingId, disabled]);

  const editingItem = useMemo(
    () => (editingId ? items.find((item) => item.id === editingId) : undefined),
    [items, editingId]
  );
  const editingIsMultiline = Boolean(
    editingItem && todoTextHasLineBreak(editingItem.content)
  );

  const singleLineInputRef = useRef<HTMLInputElement>(null);
  const multilineTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleToggle = useCallback(
    (id: string) => {
      const updated = items.map((item) =>
        item.id === id
          ? {
              ...item,
              status: item.status === "completed" ? "pending" : "completed",
            }
          : item
      );
      onChange(updated);
    },
    [items, onChange]
  );

  const handleDelete = useCallback(
    (id: string) => {
      onChange(items.filter((item) => item.id !== id));
      if (editingId === id) setEditingId(null);
    },
    [items, onChange, editingId]
  );

  const handleAdd = useCallback(() => {
    const newItem: TodoChecklistItem = {
      id: `todo-${Date.now()}`,
      content: "",
      status: "pending",
    };
    setEditingId(newItem.id);
    onChange([...items, newItem]);
  }, [items, onChange]);

  const autoResize = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = `${SINGLE_LINE_PX}px`;
    if (!todoTextHasLineBreak(element.value)) {
      element.style.height = `${SINGLE_LINE_PX}px`;
      return;
    }
    const overflow = element.scrollHeight - SINGLE_LINE_PX;
    if (overflow > SINGLE_LINE_PX / 2) {
      element.style.height = `${element.scrollHeight}px`;
    }
  }, []);

  const handleKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
      id: string
    ) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const value = event.currentTarget.value.trim();
        if (value) {
          const newItem: TodoChecklistItem = {
            id: `todo-${Date.now()}`,
            content: "",
            status: "pending",
          };
          const idx = items.findIndex((item) => item.id === id);
          const updated = items.map((item) =>
            item.id === id ? { ...item, content: value } : item
          );
          updated.splice(idx + 1, 0, newItem);
          onChange(updated);
          setEditingId(newItem.id);
        } else {
          handleDelete(id);
        }
      }
      if (event.key === "Escape") {
        const value = event.currentTarget.value.trim();
        if (!value) {
          handleDelete(id);
        } else {
          setEditingId(null);
        }
      }
    },
    [items, onChange, handleDelete]
  );

  const handleBlur = useCallback(
    (id: string, value: string) => {
      const trimmed = value.trim();
      if (trimmed) {
        const updated = items.map((item) =>
          item.id === id ? { ...item, content: trimmed } : item
        );
        onChange(updated);
        setEditingId(null);
      } else {
        handleDelete(id);
      }
    },
    [items, onChange, handleDelete]
  );

  const handleRowClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, id: string) => {
      if (disabled) return;
      const targetElement = event.target as HTMLElement | null;
      if (!targetElement) return;

      if (
        targetElement.closest("button, label, input, textarea, .input-wrapper")
      ) {
        return;
      }

      setEditingId(id);
    },
    [disabled]
  );

  useLayoutEffect(() => {
    if (!editingId || disabled) return;
    if (editingIsMultiline) {
      const element = multilineTextareaRef.current;
      if (!element) return;
      element.focus({ preventScroll: true });
      autoResize(element);
    } else {
      singleLineInputRef.current?.focus({ preventScroll: true });
    }
  }, [editingId, disabled, editingIsMultiline, autoResize]);

  const completedCount = items.filter(
    (item) => item.status === "completed"
  ).length;

  return (
    <div className={className}>
      {!hideHeader && (
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-text-2">
            <span className="font-semibold">
              {items.length} {title}
            </span>
            {completedCount > 0 && (
              <span className="ml-1 text-text-3">
                · {completedCount} {doneLabel}
              </span>
            )}
          </span>
          {!disabled && (
            <button
              className="flex cursor-pointer items-center gap-1 rounded border-none bg-transparent px-1.5 py-0.5 text-xs text-text-3 transition-colors hover:bg-fill-2 hover:text-text-2"
              onClick={handleAdd}
            >
              <Plus size={14} />
              {createLabel}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-px">
        {items.map((item) => {
          const isEditing = editingId === item.id;
          const multilineItem = todoTextHasLineBreak(item.content);
          const completedReadonly =
            item.status === "completed" && !isEditing
              ? "text-text-3 line-through"
              : "text-text-1";

          return (
            <div
              key={item.id}
              className={`group flex items-start gap-2 rounded-md px-1 transition-colors ${rowHoverClass}`}
              onClick={(event) => handleRowClick(event, item.id)}
            >
              <div className="flex h-[30px] shrink-0 items-center">
                <Checkbox
                  checked={item.status === "completed"}
                  onChange={() => handleToggle(item.id)}
                  disabled={disabled}
                />
              </div>

              <div className="min-h-[30px] min-w-0 flex-1 cursor-text py-0">
                {!isEditing || disabled ? (
                  <span
                    className={`block cursor-text whitespace-pre-wrap break-words ${ROW_TEXT_CLASS} ${completedReadonly}`}
                  >
                    {item.content || (
                      <span className="text-text-3">{placeholder}</span>
                    )}
                  </span>
                ) : multilineItem ? (
                  <textarea
                    ref={multilineTextareaRef}
                    rows={1}
                    maxLength={MAX_TODO_LENGTH}
                    defaultValue={item.content}
                    placeholder={placeholder}
                    className={`box-border w-full resize-none appearance-none overflow-hidden border-none bg-transparent p-0 text-text-1 outline-none placeholder:text-text-3 ${ROW_TEXT_CLASS} whitespace-pre-wrap break-words`}
                    style={{ minHeight: SINGLE_LINE_PX }}
                    onKeyDown={(event) => handleKeyDown(event, item.id)}
                    onBlur={(event) => handleBlur(item.id, event.target.value)}
                    onInput={(event) =>
                      autoResize(event.target as HTMLTextAreaElement)
                    }
                  />
                ) : (
                  <Input
                    ref={singleLineInputRef}
                    type="text"
                    size="small"
                    maxLength={MAX_TODO_LENGTH}
                    defaultValue={item.content}
                    placeholder={placeholder}
                    className={TODO_LINE_INPUT_WRAPPER_CLASS}
                    inputClassName={TODO_LINE_INPUT_FIELD_CLASS}
                    onKeyDown={(event) => handleKeyDown(event, item.id)}
                    onBlur={(event) => handleBlur(item.id, event.target.value)}
                  />
                )}
              </div>

              {!disabled && (
                <div className="flex h-[30px] shrink-0 items-center">
                  <button
                    type="button"
                    className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-danger-6 opacity-0 transition-opacity duration-150 hover:bg-danger-1 group-hover:opacity-100"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TodoChecklist;
