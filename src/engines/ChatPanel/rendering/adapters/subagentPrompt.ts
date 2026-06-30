import type { SessionEvent } from "@src/engines/SessionCore/core/types";

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isGenericTaskLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "task" || normalized === "todo";
}

function isPastePlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("paste://") ||
    normalized.includes("[paste:") ||
    normalized.startsWith("pasted.txt")
  );
}

function isResultLikeReport(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("now i have all the data") ||
    normalized.startsWith("here is the comprehensive report") ||
    normalized.startsWith("# comprehensive `") ||
    normalized.startsWith("# comprehensive .rs")
  );
}

function isParentDelegationRequest(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("subagent") &&
    normalized.includes("启动") &&
    (normalized.includes("让它") || normalized.includes("必须要用subagent"))
  );
}

export function validSubagentAssignmentPrompt(
  value: unknown
): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  if (isGenericTaskLabel(text)) return undefined;
  if (isPastePlaceholder(text)) return undefined;
  if (isResultLikeReport(text)) return undefined;
  if (isParentDelegationRequest(text)) return undefined;
  return text;
}

export function firstSubagentAssignmentPrompt(
  ...values: unknown[]
): string | undefined {
  for (const value of values) {
    const text = validSubagentAssignmentPrompt(value);
    if (text) return text;
  }
  return undefined;
}

export function extractSubagentPromptFromChildEvents(
  events: readonly Pick<SessionEvent, "source" | "result" | "displayText">[]
): string | undefined {
  for (const event of events) {
    if (event.source !== "user") continue;
    const text = firstSubagentAssignmentPrompt(
      event.result?.content,
      event.result?.observation,
      event.displayText
    );
    if (text) return text;
  }
  return undefined;
}
