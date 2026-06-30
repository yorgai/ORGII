import type { SessionEvent } from "@src/engines/SessionCore/core/types";

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function firstSubagentAssignmentPrompt(
  ...values: unknown[]
): string | undefined {
  for (const value of values) {
    const text = nonEmptyString(value);
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
