/**
 * Agent Config Tab Factories
 *
 * Hosts the multi-tab agent / team detail view inside the WorkStation Code
 * Editor surface. Opened from the Agent Teams page table rows in the same
 * way skill previews are opened — `openAgentConfigInWorkStation` writes
 * one of these tabs into the main pane without navigating away.
 *
 * Keyed by `<variant>:<entityId>` so re-clicking the same row focuses the
 * existing tab instead of creating a duplicate.
 */
import { defineTabFactory } from "../tabFactory";
import type { AgentConfigTabData, WorkStationTab } from "../types";

export const agentConfigTabFactory = defineTabFactory<AgentConfigTabData>({
  tabType: "agent-config",
  icon: "Infinity",
  idStrategy: {
    type: "keyed",
    prefix: "agent-config",
    getKey: (data) => `${data.variant}:${data.entityId}`,
  },
  getTitle: (data) => data.displayName || data.entityId,
});

export function createAgentConfigTab(data: AgentConfigTabData): WorkStationTab {
  return agentConfigTabFactory(data);
}
