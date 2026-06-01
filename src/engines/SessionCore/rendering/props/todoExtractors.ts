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

export function extractTodoData(props: UniversalEventProps): ExtractedTodoData {
  if (props.rustExtracted?.kind === "todo") {
    const t = props.rustExtracted;
    return {
      todos: t.todos,
      wasMerge: t.wasMerge,
    };
  }

  const { args, result } = props;

  let rawTodos: unknown;
  let wasMerge = false;

  const rawObservation = (result as Record<string, unknown>)?.observation;
  let parsedObservation: Record<string, unknown> | null = null;

  if (typeof rawObservation === "string") {
    parsedObservation = parsePythonDict(rawObservation);
  } else if (typeof rawObservation === "object" && rawObservation) {
    parsedObservation = rawObservation as Record<string, unknown>;
  }

  if (parsedObservation) {
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

  const todosArray = TodoArraySchema.safeParse(rawTodos).data ?? [];

  const todos = todosArray.map((todo) => {
    const todoObj = todo as Record<string, unknown>;
    const rawBlockedBy = todoObj.blockedBy;
    const blockedBy =
      Array.isArray(rawBlockedBy) && rawBlockedBy.length > 0
        ? (rawBlockedBy as number[])
        : undefined;
    return {
      id: (todoObj.id as string) || "",
      content:
        (todoObj.content as string) || (todoObj.description as string) || "",
      status: (todoObj.status as string) || "pending",
      blockedBy,
    };
  });

  return { todos, wasMerge };
}
