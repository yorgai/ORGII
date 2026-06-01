import type {
  EventDisplayStatus,
  SessionEvent,
} from "@src/engines/SessionCore/core/types";

export function generateMockId(): string {
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEvent(
  functionName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  actionType: string = "tool_call",
  displayStatus: EventDisplayStatus = "completed"
): SessionEvent {
  const id = generateMockId();
  return {
    chunk_id: id,
    id,
    sessionId: "mock-session-001",
    actionType,
    functionName,
    uiCanonical: "",
    args,
    result,
    source: actionType === "user" ? "user" : "assistant",
    displayText: "",
    displayStatus,
    displayVariant: actionType === "user" ? "message" : "tool_call",
    activityStatus: "agent",
    createdAt: new Date().toISOString(),
  };
}

/** 12 tasks for Playground / Single Event preview (merge update + show more) */
export const MOCK_MANAGE_TODO_12_ITEMS = [
  {
    id: "1",
    content: "Create NotificationContext for state management",
    status: "completed",
  },
  {
    id: "2",
    content: "Implement NotificationProvider component",
    status: "completed",
  },
  {
    id: "3",
    content: "Create Toast notification UI component",
    status: "in_progress",
  },
  { id: "4", content: "Add notification API endpoints", status: "pending" },
  {
    id: "5",
    content: "Integrate with existing user actions",
    status: "pending",
  },
  {
    id: "6",
    content: "Add unit tests for notification hooks",
    status: "pending",
  },
  {
    id: "7",
    content: "Wire analytics events for dismiss and click",
    status: "pending",
  },
  {
    id: "8",
    content: "Document notification API in README",
    status: "pending",
  },
  { id: "9", content: "Add i18n strings for toast copy", status: "pending" },
  {
    id: "10",
    content: "Handle offline queue for notifications",
    status: "pending",
  },
  {
    id: "11",
    content: "Performance review: avoid re-renders on global state",
    status: "pending",
  },
  { id: "12", content: "QA pass on mobile viewports", status: "pending" },
] as const;

/** Playground status presets for `subagent` — full args/result per state (see SingleEventPreview). */
export interface SubagentPlaygroundPreset {
  key: string;
  label: string;
  status: EventDisplayStatus;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export const SUBAGENT_PLAYGROUND_PRESETS: SubagentPlaygroundPreset[] = [
  {
    key: "starting",
    label: "Assigning (no session yet)",
    status: "running",
    args: {
      agent_id: "builtin:explore",
      subagent_type: "explore",
      action: "assign",
      task: "Find circular import chains in the codebase",
      prompt:
        "Scan all TypeScript files for circular import chains. Report each cycle with the involved file paths and hop count.",
      fork: true,
    },
    result: {},
  },
  {
    key: "completed",
    label: "Completed",
    status: "completed",
    args: {
      agent_id: "builtin:explore",
      subagent_type: "explore",
      action: "delegate",
      task: "Map HTTP client usage before the session API migration",
      prompt:
        "Find every React component under `src/` that imports from `@src/api/http`. Return file paths grouped by feature area. Flag any barrel files that re-export HTTP helpers.",
      fork: true,
      elapsedMs: 8420,
      toolCallCount: 5,
      subagentSessionId: "mock-subagent-explore-01",
    },
    result: {
      success: true,
      summary:
        "Seven components import @src/api/http directly across 3 feature areas; one barrel re-export should be redirected.",
      files_found: 7,
      content: `Seven components import \`@src/api/http\` directly. Two feature areas share a barrel re-export through \`src/features/auth/index.ts\`.

**Main app shell** — IntegrationsPage, Marketplace, BillingPanel
**Session / keys** — KeyVaultWizard, SessionCreator
**Shared widgets** — ProviderList, WalletWidget

\`src/features/auth/index.ts\` re-exports HTTP helpers; point new code at \`@src/api/session\` after the migration. The remaining 6 call sites can be updated in a single sweep.`,
    },
  },
  {
    key: "running",
    label: "Running",
    status: "running",
    args: {
      agent_id: "builtin:explore",
      subagent_type: "explore",
      action: "delegate",
      task: "Find circular import chains in the codebase",
      prompt:
        "Scan all TypeScript files for circular import chains. Report each cycle with the involved file paths and hop count.",
      fork: true,
      elapsedMs: 3200,
      toolCallCount: 3,
      subagentSessionId: "mock-subagent-running-01",
    },
    result: {},
  },
  {
    key: "failed",
    label: "Failed",
    status: "failed",
    args: {
      agent_id: "builtin:general",
      subagent_type: "planner",
      task: "Open GraphQL migration epic with linked subtasks",
      prompt:
        'Create a tracking epic "Session API cutover" with subtasks for: (1) HTTP import map sign-off, (2) KeyVault adapter, (3) Playground QA, (4) release notes. Attach estimates and owners from TEAM.yaml.',
      fork: false,
    },
    result: {
      success: false,
      error:
        "Input exceeded the planner context budget (requested ~18k tokens; limit 8k). Shorten TEAM.yaml attachment or split into two epic batches.",
      error_message:
        "Input exceeded the planner context budget (requested ~18k tokens; limit 8k). Shorten TEAM.yaml attachment or split into two epic batches.",
      content:
        "Could not create work items: planner refused oversized batch input.",
    },
  },
  {
    key: "truncated",
    label: "Truncated result",
    status: "completed",
    args: {
      agent_id: "builtin:general",
      subagent_type: "audit",
      task: "Repository-wide static audit (size, cycles, dead exports)",
      prompt:
        "Enumerate every tracked file, LOC by top-level directory, circular import graph, and unused exports.",
      fork: true,
      elapsedMs: 195400,
      toolCallCount: 14,
      subagentSessionId: "mock-subagent-audit-01",
    },
    result: {
      success: true,
      truncated: true,
      summary:
        "Audit complete: 1,247 files, 89,342 LOC, 9 circular chains, 23 unused exports, 4 oversize files.",
      char_count: 294912,
      bytes_on_disk: 301852,
      result_path:
        "/Users/demo/projects/orgii/.orgii/tool-results/repo-audit-20260410120000.txt",
      preview:
        "Audit finished. 1,247 files, 89,342 LOC. Circular imports: 9 chains (worst 4-hop: SessionCore/sync ↔ hooks). Unused exports: 23 symbols. Files >600 lines: 4.",
      content: `Audit finished across 1,247 files totaling 89,342 lines of code.

**Circular imports:** 9 chains detected. Worst offender is a 4-hop cycle between \`engines/SessionCore/sync\` and \`hooks/workspace\`. The remaining 8 are 2-hop cycles.

**Unused exports:** 23 symbols across 14 files. Most are legacy helpers in \`src/util/\` that were superseded by newer implementations.

**Oversize files:** 4 files exceed the 600-line limit (largest: \`ChatPanel/index.tsx\` at 742 lines).

The complete dependency graph and per-folder LOC breakdown are in the linked artifact on disk.`,
    },
  },
];
