/**
 * Shared Test Fixtures for Session Rendering Tests
 *
 * Factory functions and sample payloads for testing the rendering pipeline.
 * Used by propsNormalizer, propsDataExtractors, and integration tests.
 */
import type { OptimizedChatItem } from "@src/engines/ChatPanel/ChatHistory/chatItemPipeline/types";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type {
  EventStatus,
  EventVariant,
  RenderContext,
  UniversalEventProps,
} from "../../types/universalProps";

// ============================================
// Factory: UniversalEventProps
// ============================================

export function makeUniversalProps(
  overrides: Partial<UniversalEventProps> = {}
): UniversalEventProps {
  return {
    eventId: "evt-001",
    eventType: "tool_call",
    args: {},
    result: {},
    status: "success" as EventStatus,
    showActiveEventPainting: false,
    variant: "chat" as EventVariant,
    context: "chat" as RenderContext,
    ...overrides,
  };
}

// ============================================
// Factory: SessionEvent
// ============================================

let activityCounter = 0;

/**
 * Create a SessionEvent for testing. Fields default to a read_file tool_call.
 * Accepts shorthand overrides: `function` maps to `functionName`,
 * `action_type` maps to `actionType`, etc.
 */
export function makeSessionEvent(
  overrides: Partial<SessionEvent> & Record<string, unknown> = {}
): SessionEvent {
  activityCounter++;
  const functionName =
    (overrides.functionName as string) ??
    (overrides.function as string) ??
    "read_file";
  const actionType =
    (overrides.actionType as string) ??
    (overrides.action_type as string) ??
    "tool_call";
  return {
    id: overrides.id ?? `chunk-${activityCounter}`,
    chunk_id: overrides.chunk_id ?? null,
    sessionId: overrides.sessionId ?? "session-test-001",
    createdAt:
      overrides.createdAt ??
      `2026-04-01T10:00:${String(activityCounter).padStart(2, "0")}Z`,
    functionName,
    uiCanonical: (overrides.uiCanonical as string) ?? "",
    actionType,
    args:
      "args" in overrides ? (overrides.args as Record<string, unknown>) : {},
    result:
      "result" in overrides
        ? (overrides.result as Record<string, unknown>)
        : {},
    source: (overrides.source as SessionEvent["source"]) ?? "assistant",
    displayText: (overrides.displayText as string) ?? "",
    displayStatus:
      "displayStatus" in overrides
        ? (overrides.displayStatus as SessionEvent["displayStatus"])
        : "completed",
    displayVariant:
      (overrides.displayVariant as SessionEvent["displayVariant"]) ??
      "tool_call",
    activityStatus:
      (overrides.activityStatus as SessionEvent["activityStatus"]) ?? "agent",
    ...(overrides.threadId ? { threadId: overrides.threadId } : {}),
    ...(overrides.processId ? { processId: overrides.processId } : {}),
    ...(overrides.callId ? { callId: overrides.callId } : {}),
    ...(overrides.shellPid ? { shellPid: overrides.shellPid } : {}),
    ...(overrides.shellProcessStatus
      ? { shellProcessStatus: overrides.shellProcessStatus }
      : {}),
    ...(overrides.shellExitCode !== undefined
      ? { shellExitCode: overrides.shellExitCode }
      : {}),
    ...(overrides.shellLogPath ? { shellLogPath: overrides.shellLogPath } : {}),
  } as SessionEvent;
}

export function resetActivityCounter(): void {
  activityCounter = 0;
}

// ============================================
// Factory: OptimizedChatItem (wrapping SessionEvent)
// ============================================

export function makeChatItem(
  event: SessionEvent,
  overrides: Partial<OptimizedChatItem> = {}
): OptimizedChatItem {
  return {
    type: "activity",
    chunk_id: event.id,
    event,
    ...overrides,
  };
}

// ============================================
// Factory: RawEventInput (for propsNormalizer)
// ============================================

export function makeChatInput(
  overrides: Record<string, unknown> = {},
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  // Map legacy snake_case test overrides to SessionEvent camelCase fields
  const { status, created_at, chunk_id, ...rest } = overrides;
  return {
    event: makeSessionEvent({
      id: (chunk_id as string) ?? "chunk-chat-001",
      actionType: "tool_call",
      function: "read_file",
      ...(status
        ? { displayStatus: status as SessionEvent["displayStatus"] }
        : {}),
      ...(created_at ? { createdAt: created_at as string } : {}),
      ...rest,
    }),
    ...extras,
  };
}

export function makeSimulatorInput(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    event_id: "evt-sim-001",
    function: "read_file",
    action_type: "tool_call",
    args: {},
    result: {},
    created_time: "2026-04-01T10:00:00Z",
    ...overrides,
  };
}

export function makeTrajectoryInput(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    event_id: "evt-traj-001",
    function: "read_file",
    action_type: "tool_call",
    args: {},
    result: {},
    isSelected: false,
    onSelect: () => {},
    ...overrides,
  };
}

// ============================================
// Real-World Payload Samples
// ============================================

export const SDE_READ_FILE_PAYLOAD = {
  action_type: "tool_call",
  function: "read_file",
  args: { file_path: "src/utils/helpers.ts" },
  result: {
    output: {
      success: {
        content:
          "export function add(a: number, b: number) {\n  return a + b;\n}\n",
        path: "src/utils/helpers.ts",
      },
    },
  },
};

export const CLI_EDIT_PAYLOAD = {
  action_type: "tool_call",
  function: "Edit",
  args: {
    file_path: "src/app.ts",
    old_str: "const x = 1;",
    new_str: "const x = 2;",
  },
  result: {
    output: {
      success: {
        diffString:
          "--- src/app.ts\n+++ src/app.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;",
        path: "src/app.ts",
        linesAdded: 1,
        linesRemoved: 1,
      },
    },
  },
};

export const OS_SHELL_PAYLOAD = {
  action_type: "tool_call",
  function: "execute",
  args: { command: "npm test", cwd: "/project" },
  result: {
    output: {
      success: {
        command: "npm test",
        stdout: "All tests passed\n",
        stderr: "",
        exitCode: 0,
        executionTime: 1234,
      },
    },
  },
};

export const APPLY_PATCH_PAYLOAD = {
  action_type: "tool_call",
  function: "apply_patch",
  args: {
    patch_text: [
      "*** Begin Patch",
      "*** Add File: src/newFile.ts",
      "+export const greeting = 'hello';",
      "+export const farewell = 'bye';",
      "*** Modify File: src/existing.ts",
      "-const old = true;",
      "+const updated = true;",
      " const unchanged = 42;",
      "*** End Patch",
    ].join("\n"),
  },
  result: { content: "Patch applied successfully" },
};

export const TODO_WRITE_PYTHON_PAYLOAD = {
  action_type: "tool_call",
  function: "manage_todo",
  args: {},
  result: {
    observation:
      "{'success': {'todos': [{'id': 'todo-1', 'content': 'Implement feature', 'status': 'in_progress'}, {'id': 'todo-2', 'content': 'Write tests', 'status': 'pending'}], 'wasMerge': True}}",
  },
};

export const MANAGE_TODO_JSON_PAYLOAD = {
  action_type: "tool_call",
  function: "manage_todo",
  args: {
    todos: [
      { id: "t1", content: "Task one", status: "completed" },
      { id: "t2", content: "Task two", status: "pending" },
    ],
  },
  result: {
    output: {
      success: {
        todos: [
          { id: "t1", content: "Task one", status: "completed" },
          { id: "t2", content: "Task two", status: "pending" },
        ],
      },
    },
  },
};

export const SEARCH_PAYLOAD = {
  action_type: "tool_call",
  function: "code_search",
  args: { query: "handleSubmit" },
  result: {
    matches: [
      { file: "src/form.ts", line: 42, content: "function handleSubmit() {" },
      {
        file: "src/login.ts",
        line: 15,
        content: "const handleSubmit = async",
      },
    ],
    total: 2,
  },
};

export const WEB_SEARCH_PAYLOAD = {
  action_type: "tool_call",
  function: "web_search",
  args: { search_term: "react hooks best practices" },
  result: {
    output: {
      success: {
        results: [{ title: "React Hooks Guide", url: "https://example.com" }],
      },
    },
  },
};

export const THINKING_PAYLOAD = {
  action_type: "thinking",
  function: "thinking",
  args: { content: "Let me analyze the code structure..." },
  result: {
    thought: "The file structure uses a modular pattern.",
    duration: 2500,
  },
};

export const FAILED_TOOL_CALL_PAYLOAD = {
  action_type: "tool_call",
  function: "read_file",
  args: { file_path: "/nonexistent/file.ts" },
  result: {
    output: {
      failure: {
        error: "File not found",
        code: "ENOENT",
      },
    },
  },
};

export const STREAMING_EDIT_PAYLOAD = {
  action_type: "tool_call",
  function: "edit_file",
  args: {
    file_path: "src/app.ts",
    streamContent: "const streaming = true;\\nconst more = 'content';",
  },
  result: { status: "running" },
};

export const CONSULT_PAYLOAD = {
  action_type: "tool_call",
  function: "consult",
  args: { model: "gpt-4", prompt: "Review this code" },
  result: {
    output: {
      success: {
        response: "The code looks good, but consider adding error handling.",
        model: "gpt-4",
      },
    },
  },
};

export const USER_INPUT_PAYLOAD = {
  action_type: "user_input",
  function: "user",
  args: {},
  result: {
    message: {
      role: "user",
      content: "Help me refactor this function",
    },
  },
};

export const SHELL_STREAMING_PAYLOAD = {
  action_type: "tool_call",
  function: "run_shell",
  args: {
    command: "npm run build",
    description: "Build the project",
    streamOutput: "Building...\nCompiling TypeScript...",
  },
  result: { status: "running" },
};

export const GEMINI_TODO_PAYLOAD = {
  action_type: "tool_call",
  function: "TodoWrite",
  args: {},
  result: {
    output: {
      success: {
        todos: [
          { id: "g1", description: "Gemini task one", status: "pending" },
          { id: "g2", description: "Gemini task two", status: "completed" },
        ],
      },
    },
  },
};
