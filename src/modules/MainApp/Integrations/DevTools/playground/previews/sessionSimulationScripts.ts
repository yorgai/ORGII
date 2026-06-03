import type {
  LiveFlowScript,
  ScriptPresetEntry,
} from "./sessionSimulationTypes";

export const DEFAULT_LIVE_FLOW_SCRIPT: LiveFlowScript = {
  intro: "Got it. I will execute a local mock session for: {{message}}",
  steps: [
    {
      type: "activity",
      delayMs: 280,
      function: "codebase_search",
      status: "running",
      args: {
        query: "{{message}}",
        path: "src/",
      },
      result: {},
    },
    {
      type: "activity",
      delayMs: 780,
      function: "codebase_search",
      status: "completed",
      args: {
        query: "{{message}}",
        path: "src/",
      },
      result: {
        success: true,
        results: [
          {
            file: "src/components/Button/index.tsx",
            line: 12,
            content: "export interface ButtonProps {",
          },
          {
            file: "src/modules/MainApp/Integrations/DevTools/playground/SessionSimulation.tsx",
            line: 1,
            content: "import React, { useCallback } from 'react';",
          },
        ],
        total_matches: 2,
      },
    },
    {
      type: "activity",
      delayMs: 350,
      function: "read_file",
      status: "running",
      args: {
        path: "src/components/Button/index.tsx",
      },
      result: {},
    },
    {
      type: "activity",
      delayMs: 680,
      function: "read_file",
      status: "completed",
      args: {
        path: "src/components/Button/index.tsx",
      },
      result: {
        success: true,
        content:
          "import React from 'react';\n\ninterface ButtonProps {\n  children: ReactNode;\n}\n\nexport function Button({ children }: ButtonProps) {\n  return <button>{children}</button>;\n}",
        file_path: "src/components/Button/index.tsx",
      },
    },
    {
      type: "message",
      delayMs: 220,
      content:
        "Search and read completed. Next I can continue with edit_file if needed.",
    },
  ],
  final:
    "Local mock flow completed. Update the JSON script to customize the next chat turn.",
};

const SEARCH_FLOW_SCRIPT: LiveFlowScript = {
  intro: "Search flow activated for: {{message}}",
  steps: [
    {
      type: "activity",
      delayMs: 220,
      function: "codebase_search",
      status: "running",
      args: { query: "{{message}}", path: "src/" },
      result: {},
    },
    {
      type: "activity",
      delayMs: 680,
      function: "codebase_search",
      status: "completed",
      args: { query: "{{message}}", path: "src/" },
      result: {
        success: true,
        total_matches: 3,
        results: [
          {
            file: "src/modules/MainApp/Integrations/DevTools/playground/SessionSimulation.tsx",
            line: 190,
            content: "function buildFlowFromScript(",
          },
        ],
      },
    },
  ],
  final: "Search flow finished.",
};

const TEST_FLOW_SCRIPT: LiveFlowScript = {
  intro: "Test flow started for: {{message}}",
  steps: [
    {
      type: "activity",
      delayMs: 240,
      function: "run_terminal_cmd",
      status: "running",
      args: { command: "npm run test", working_directory: "." },
      result: {},
    },
    {
      type: "activity",
      delayMs: 980,
      function: "run_terminal_cmd",
      status: "completed",
      args: { command: "npm run test", working_directory: "." },
      result: {
        success: true,
        output:
          "PASS src/components/Button/__tests__/Button.test.tsx\nPASS src/components/Input/__tests__/Input.test.tsx\n\nTest Suites: 2 passed, 2 total\nTests: 14 passed, 14 total",
        exit_code: 0,
      },
    },
  ],
  final: "Test flow finished successfully.",
};

const BRANCHING_FLOW_SCRIPT: LiveFlowScript = {
  intro: "Branch router received: {{message}}",
  steps: [
    {
      type: "message",
      delayMs: 160,
      content:
        "No keyword matched. This is fallback branch. Configure `branches` to route by message intent.",
    },
  ],
  branches: [
    {
      id: "test-branch",
      keywords: ["test", "npm", "build"],
      intro: "Matched test branch for: {{message}}",
      steps: TEST_FLOW_SCRIPT.steps ?? [],
      final: "Test branch completed.",
    },
    {
      id: "search-branch",
      keywords: ["find", "search", "where"],
      intro: "Matched search branch for: {{message}}",
      steps: SEARCH_FLOW_SCRIPT.steps ?? [],
      final: "Search branch completed.",
    },
    {
      id: "edit-branch",
      keywords: ["edit", "refactor", "update", "fix"],
      intro: "Matched edit branch for: {{message}}",
      steps: [
        {
          type: "activity",
          delayMs: 280,
          function: "read_file",
          status: "running",
          args: { path: "src/components/Button/index.tsx" },
          result: {},
        },
        {
          type: "activity",
          delayMs: 720,
          function: "read_file",
          status: "completed",
          args: { path: "src/components/Button/index.tsx" },
          result: {
            success: true,
            file_path: "src/components/Button/index.tsx",
            content: "interface ButtonProps { children: ReactNode; }",
          },
        },
        {
          type: "activity",
          delayMs: 320,
          function: "edit_file",
          status: "completed",
          args: {
            path: "src/components/Button/index.tsx",
            old_string: "interface ButtonProps {",
            new_string: "interface ButtonProps {\n  loading?: boolean;",
          },
          result: {
            success: true,
            file_path: "src/components/Button/index.tsx",
            lines_added: 1,
            lines_removed: 0,
          },
        },
      ],
      final: "Edit branch completed.",
    },
  ],
  final: "Fallback branch completed.",
};

const SUBAGENT_FLOW_SCRIPT: LiveFlowScript = {
  intro:
    "I'll launch a subagent to research this. Let me delegate the research task.",
  steps: [
    {
      type: "activity",
      delayMs: 400,
      function: "agent",
      uiCanonical: "title_only",
      status: "running",
      args: {
        agent_id: "builtin:explore",
        description: "Research {{message}}",
        subagent_type: "explore",
        action: "assign",
        prompt:
          "Research {{message}} across the frontend event pipeline. Report the key files involved and the dominant data-flow shape (Rust → IPC → frontend store).",
      },
      result: {},
    },
    {
      type: "activity",
      delayMs: 800,
      function: "agent",
      uiCanonical: "subagent",
      status: "running",
      args: {
        agent_id: "builtin:explore",
        description: "Research {{message}}",
        subagent_type: "explore",
        action: "delegate",
        subagentSessionId: "mock-subagent-explore-001",
        prompt:
          "Research {{message}} across the frontend event pipeline. Report the key files involved and the dominant data-flow shape (Rust → IPC → frontend store).",
      },
      result: {},
    },
    {
      type: "activity",
      delayMs: 1400,
      function: "agent",
      uiCanonical: "subagent",
      status: "running",
      args: {
        agent_id: "builtin:explore",
        description: "Research {{message}}",
        subagent_type: "explore",
        action: "delegate",
        subagentSessionId: "mock-subagent-explore-001",
        prompt:
          "Research {{message}} across the frontend event pipeline. Report the key files involved and the dominant data-flow shape (Rust → IPC → frontend store).",
        toolCallCount: 4,
      },
      result: {},
    },
    {
      type: "activity",
      delayMs: 2000,
      function: "agent",
      uiCanonical: "subagent",
      status: "completed",
      args: {
        agent_id: "builtin:explore",
        description: "Research {{message}}",
        subagent_type: "explore",
        action: "delegate",
        subagentSessionId: "mock-subagent-explore-001",
        prompt:
          "Research {{message}} across the frontend event pipeline. Report the key files involved and the dominant data-flow shape (Rust → IPC → frontend store).",
        elapsedMs: 4600,
        toolCallCount: 6,
      },
      result: {
        success: true,
        status: "completed",
        content:
          "Found 3 key files related to the query:\n\n**EventStoreProxy.ts** — Frontend wrapper for the Rust EventStore, handles `es:changed` routing.\n\n**subagentHandler.rs** — Rust handler for subagent lifecycle (start → tool calls → complete).\n\n**useSessionEvents.ts** — React hook for lazy-loading child session events.\n\nThe data flows: Rust `push_events_to_session` → `es:changed` emit → `subscribeSession` listener → React state update.",
      },
    },
  ],
  final:
    "The subagent has completed its investigation. Based on the findings, the event pipeline flows from Rust through IPC to the frontend EventStore proxy.",
};

const SUBAGENT_FAILED_FLOW_SCRIPT: LiveFlowScript = {
  intro:
    "I'll delegate this to a planning subagent — the task exceeds the single-shot budget.",
  steps: [
    {
      type: "activity",
      delayMs: 400,
      function: "agent",
      uiCanonical: "title_only",
      status: "running",
      args: {
        agent_id: "builtin:general",
        description: "Draft migration epic for {{message}}",
        subagent_type: "planner",
        action: "assign",
        prompt:
          "Create a tracking epic “Session API cutover” with subtasks for (1) HTTP import map sign-off, (2) KeyVault adapter, (3) Playground QA, (4) release notes. Attach estimates and owners from TEAM.yaml.",
      },
      result: {},
    },
    {
      type: "activity",
      delayMs: 1200,
      function: "agent",
      uiCanonical: "subagent",
      status: "running",
      args: {
        agent_id: "builtin:general",
        description: "Draft migration epic for {{message}}",
        subagent_type: "planner",
        action: "delegate",
        subagentSessionId: "mock-subagent-planner-failed-01",
        prompt:
          "Create a tracking epic “Session API cutover” with subtasks for (1) HTTP import map sign-off, (2) KeyVault adapter, (3) Playground QA, (4) release notes. Attach estimates and owners from TEAM.yaml.",
      },
      result: {},
    },
    {
      type: "activity",
      delayMs: 2200,
      function: "agent",
      uiCanonical: "subagent",
      status: "failed",
      args: {
        agent_id: "builtin:general",
        description: "Draft migration epic for {{message}}",
        subagent_type: "planner",
        action: "delegate",
        subagentSessionId: "mock-subagent-planner-failed-01",
        prompt:
          "Create a tracking epic “Session API cutover” with subtasks for (1) HTTP import map sign-off, (2) KeyVault adapter, (3) Playground QA, (4) release notes. Attach estimates and owners from TEAM.yaml.",
        elapsedMs: 3200,
        toolCallCount: 2,
      },
      result: {
        success: false,
        status: "failed",
        error_message:
          "Input exceeded the planner context budget (requested ~18k tokens; limit 8k). Shorten TEAM.yaml attachment or split into two epic batches.",
        content:
          "Partial plan: 2 of 4 subtasks drafted before context overflow. Nothing was persisted to the issue tracker.",
      },
    },
  ],
  final:
    "The planner subagent aborted on a context-budget error. Expand the card above to inspect the original prompt, the two partial tool calls, and the exact error surfaced by the model.",
};

export const SCRIPT_PRESETS: ScriptPresetEntry[] = [
  { id: "default", label: "Default", script: DEFAULT_LIVE_FLOW_SCRIPT },
  { id: "search", label: "Search", script: SEARCH_FLOW_SCRIPT },
  { id: "test", label: "Test", script: TEST_FLOW_SCRIPT },
  { id: "subagent", label: "Subagent", script: SUBAGENT_FLOW_SCRIPT },
  {
    id: "subagent-failed",
    label: "Subagent (failed)",
    script: SUBAGENT_FAILED_FLOW_SCRIPT,
  },
  { id: "branching", label: "Branching", script: BRANCHING_FLOW_SCRIPT },
];

export const DEFAULT_LIVE_FLOW_SCRIPT_TEXT = JSON.stringify(
  DEFAULT_LIVE_FLOW_SCRIPT,
  null,
  2
);
