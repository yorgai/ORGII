/**
 * Todo / task list data extractor.
 */
import { z } from "zod/v4";

import type {
  ExtractedTodoData,
  UniversalEventProps,
} from "../types/universalProps";

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const TodoArraySchema = z.array(UnknownRecordSchema);

/**
 * Helper to parse Python-style dict strings.
 * Converts Python dict syntax to JSON and parses it.
 */
function parsePythonDict(str: string): Record<string, unknown> | null {
  if (!str || typeof str !== "string") return null;
  try {
    const jsonStr = str
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    return UnknownRecordSchema.parse(JSON.parse(jsonStr));
  } catch {
    return null;
  }
}

/**
 * Parse the pretty-printed JSON array that the native `manage_todo` tool
 * embeds in its text output between the header line and the progress nudge
 * (e.g. `"6 todos (4 remaining)\n[ ... ]\n\nEnsure that..."`). Mirrors the
 * Rust `parse_embedded_todo_array` in `misc_extractor.rs`.
 */
function parseEmbeddedTodoArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    return TodoArraySchema.parse(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

/** Extract `uiMetadata.data.todos` from the dual-track tool-result path. */
function todosFromUiMetadata(
  result: Record<string, unknown> | undefined
): unknown[] | null {
  const meta = result?.uiMetadata as Record<string, unknown> | undefined;
  if (!meta || meta.display_type !== "todo_list") return null;
  const data = meta.data as Record<string, unknown> | undefined;
  return Array.isArray(data?.todos) ? (data.todos as unknown[]) : null;
}

export function extractTodoData(props: UniversalEventProps): ExtractedTodoData {
  // Backend-extracted payload wins when it actually carries rows. An empty
  // Rust extraction must NOT short-circuit — older events / alternate wire
  // shapes still need the manual fallbacks below.
  if (props.rustExtracted?.kind === "todo") {
    const t = props.rustExtracted;
    if (t.todos.length > 0) {
      return {
        todos: t.todos,
        wasMerge: t.wasMerge,
      };
    }
  }

  const { args, result } = props;

  let rawTodos: unknown =
    todosFromUiMetadata(result as Record<string, unknown>) ?? undefined;
  let wasMerge = false;

  const rawObservation = (result as Record<string, unknown>)?.observation;
  let parsedObservation: Record<string, unknown> | null = null;

  if (typeof rawObservation === "string") {
    parsedObservation = parsePythonDict(rawObservation);
  } else if (typeof rawObservation === "object" && rawObservation) {
    parsedObservation = rawObservation as Record<string, unknown>;
  }

  if (!rawTodos && parsedObservation) {
    const successData = parsedObservation.success;
    if (successData && typeof successData === "object") {
      const successObj = successData as Record<string, unknown>;
      if (successObj.todos && Array.isArray(successObj.todos)) {
        rawTodos = successObj.todos;
        wasMerge = (successObj.wasMerge as boolean) || false;
      }
    } else if (
      parsedObservation.todos &&
      Array.isArray(parsedObservation.todos)
    ) {
      rawTodos = parsedObservation.todos;
      wasMerge = (parsedObservation.wasMerge as boolean) || false;
    }
  }

  if (!rawTodos || (Array.isArray(rawTodos) && rawTodos.length === 0)) {
    const outputObj = (result as Record<string, unknown>)?.output as
      | Record<string, unknown>
      | undefined;
    const successObj = outputObj?.success as
      | Record<string, unknown>
      | undefined;
    const resultSuccessObj = (result as Record<string, unknown>)?.success as
      | Record<string, unknown>
      | undefined;

    rawTodos =
      args?.todos ||
      successObj?.todos ||
      outputObj?.todos ||
      resultSuccessObj?.todos ||
      (result as Record<string, unknown>)?.todos;

    if (!wasMerge) {
      wasMerge =
        (successObj?.wasMerge as boolean) ||
        (resultSuccessObj?.wasMerge as boolean) ||
        ((result as Record<string, unknown>)?.wasMerge as boolean) ||
        false;
    }
  }

  if (typeof rawTodos === "string") {
    try {
      rawTodos = TodoArraySchema.parse(JSON.parse(rawTodos));
    } catch {
      rawTodos = [];
    }
  }

  // Last resort — the native ORGII tool's result is
  // `{"content": "<header>\n[JSON array]\n<nudge>"}`. Parse the embedded
  // snapshot out of the LLM-facing text. `args.todos` only exists for
  // `action:"write"`; `update`/`read` events depend on this path.
  if (!rawTodos || (Array.isArray(rawTodos) && rawTodos.length === 0)) {
    const content = (result as Record<string, unknown>)?.content;
    if (typeof content === "string") {
      rawTodos = parseEmbeddedTodoArray(content) ?? rawTodos;
    }
  }

  const todosArray = TodoArraySchema.safeParse(rawTodos).data ?? [];

  const todos = todosArray.map((todo) => {
    const todoObj = todo as Record<string, unknown>;
    const rawBlockedBy = todoObj.blockedBy;
    const blockedBy =
      Array.isArray(rawBlockedBy) && rawBlockedBy.length > 0
        ? (rawBlockedBy as number[])
        : undefined;
    // Native tool snapshots key rows by numeric `index`; hosted formats
    // use a string `id`. Either works as a stable id.
    const id =
      (todoObj.id as string) ||
      (typeof todoObj.index === "number" ? String(todoObj.index) : "");
    const activeForm =
      typeof todoObj.activeForm === "string" && todoObj.activeForm.trim()
        ? (todoObj.activeForm as string)
        : undefined;
    return {
      id,
      content:
        (todoObj.content as string) || (todoObj.description as string) || "",
      status: (todoObj.status as string) || "pending",
      activeForm,
      blockedBy,
    };
  });

  return { todos, wasMerge };
}
