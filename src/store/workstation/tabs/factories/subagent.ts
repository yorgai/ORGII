/**
 * Subagent Tab Factories
 *
 * Tab factories for subagent details using defineTabFactory.
 */
import { defineTabFactory } from "../tabFactory";
import type { SubagentDetailTabData, WorkStationTab } from "../types";

export const subagentDetailTabFactory = defineTabFactory<SubagentDetailTabData>(
  {
    tabType: "subagent-detail",
    idStrategy: { type: "unique", prefix: "subagent-detail" },
    getTitle: (data) => data.description || "Subagent",
    icon: "MessageSquare",
  }
);

export function createSubagentDetailTab(
  description: string,
  subagentType?: string,
  resultContent?: string,
  success?: boolean,
  subagentSessionId?: string,
  elapsedMs?: number,
  prompt?: string,
  errorMessage?: string
): WorkStationTab {
  return subagentDetailTabFactory({
    description,
    subagentType,
    resultContent,
    success,
    subagentSessionId,
    elapsedMs,
    prompt,
    errorMessage,
  });
}
