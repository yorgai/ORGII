import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type {
  BuiltLiveFlow,
  LiveActivityStatus,
  LiveChatItem,
  LiveFlowScript,
  LiveFlowStep,
  ParsedLiveFlowScript,
  ResolvedScriptRun,
} from "./sessionSimulationTypes";

function replaceTemplateText(templateValue: string, message: string): string {
  return templateValue.split("{{message}}").join(message);
}

function replaceTemplateValue<T>(value: T, message: string): T {
  if (typeof value === "string") {
    return replaceTemplateText(value, message) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceTemplateValue(item, message)) as T;
  }
  if (value && typeof value === "object") {
    const sourceRecord = value as Record<string, unknown>;
    const nextRecord: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(sourceRecord)) {
      nextRecord[key] = replaceTemplateValue(childValue, message);
    }
    return nextRecord as T;
  }
  return value;
}

export function parseLiveFlowScript(jsonInput: string): ParsedLiveFlowScript {
  try {
    const parsed = JSON.parse(jsonInput) as LiveFlowScript;
    const hasTopLevelSteps = Array.isArray(parsed.steps);
    const hasBranches =
      Array.isArray(parsed.branches) && parsed.branches.length > 0;
    if (!hasTopLevelSteps && !hasBranches) {
      return { data: null, error: "Provide steps or branches" };
    }
    if (Array.isArray(parsed.branches)) {
      const invalidBranch = parsed.branches.find(
        (branch) =>
          !Array.isArray(branch.keywords) ||
          !Array.isArray(branch.steps) ||
          branch.keywords.length === 0
      );
      if (invalidBranch) {
        return {
          data: null,
          error: "Each branch needs non-empty keywords and steps",
        };
      }
    }
    return { data: parsed, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

function resolveScriptRun(
  script: LiveFlowScript,
  message: string
): ResolvedScriptRun {
  const normalizedMessage = message.toLowerCase();
  const branches = script.branches ?? [];
  for (const branch of branches) {
    const matched = branch.keywords.some((keyword) =>
      normalizedMessage.includes(keyword.toLowerCase())
    );
    if (matched) {
      return {
        intro: branch.intro ?? script.intro,
        final: branch.final ?? script.final,
        steps: branch.steps,
        matchedBranchId: branch.id,
      };
    }
  }

  return {
    intro: script.intro,
    final: script.final,
    steps: script.steps ?? [],
  };
}

export function buildFlowFromScript(
  script: LiveFlowScript,
  message: string
): BuiltLiveFlow {
  const resolvedRun = resolveScriptRun(script, message);
  const introText = replaceTemplateText(
    resolvedRun.intro ??
      (resolvedRun.matchedBranchId
        ? "Matched branch {{message}}"
        : "I have received your request: {{message}}"),
    message
  );
  const finalText = replaceTemplateText(
    resolvedRun.final ?? "Local mock flow finished.",
    message
  );

  const steps: LiveFlowStep[] = resolvedRun.steps.map((step) => {
    const delayMs = Math.max(0, Number(step.delayMs ?? 0));
    if (step.type === "message") {
      const content = replaceTemplateText(step.content, message);
      return {
        delayMs,
        item: createLiveAgentItem(content),
      };
    }

    const functionName = step.function || "unknown";
    const uiCanonical = step.uiCanonical ?? functionName;
    const status = step.status ?? "completed";
    const args = replaceTemplateValue(step.args ?? {}, message);
    const result = replaceTemplateValue(step.result ?? {}, message);
    const event = createLiveActivity(
      functionName,
      uiCanonical,
      status,
      args,
      result
    );

    return {
      delayMs,
      item: createLiveActivityItem(event),
    };
  });

  return {
    intro: createLiveAgentItem(introText),
    steps,
    final: createLiveAgentItem(finalText),
  };
}

function createLiveActivity(
  functionName: string,
  uiCanonical: string,
  status: LiveActivityStatus,
  args: Record<string, unknown>,
  result: Record<string, unknown>
): SessionEvent {
  const now = Date.now();
  const id = `${functionName}-${now}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    chunk_id: id,
    sessionId: "playground-live-mock",
    createdAt: new Date(now).toISOString(),
    functionName,
    uiCanonical,
    actionType: "tool_call",
    args,
    result,
    source: "assistant",
    displayText: "",
    displayStatus: status,
    displayVariant: "tool_call",
    activityStatus: "agent",
  } as SessionEvent;
}

export function createLiveUserItem(message: string): LiveChatItem {
  return {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "user",
    content: message,
  };
}

function createLiveAgentItem(content: string): LiveChatItem {
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "agent",
    content,
  };
}

function createLiveActivityItem(event: SessionEvent): LiveChatItem {
  return {
    id: event.id,
    type: "activity",
    eventData: event,
  };
}

export function buildLiveFlowForMessage(message: string): BuiltLiveFlow {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("test") ||
    normalizedMessage.includes("npm") ||
    normalizedMessage.includes("build")
  ) {
    const running = createLiveActivity(
      "run_terminal_cmd",
      "run_terminal_cmd",
      "running",
      {
        command: "npm run test",
        working_directory: "src/",
      },
      {}
    );
    const completed = createLiveActivity(
      "run_terminal_cmd",
      "run_terminal_cmd",
      "completed",
      {
        command: "npm run test",
        working_directory: "src/",
      },
      {
        success: true,
        output:
          "PASS src/components/Button/__tests__/Button.test.tsx\nPASS src/components/Input/__tests__/Input.test.tsx\n\nTest Suites: 2 passed, 2 total\nTests: 14 passed, 14 total",
        exit_code: 0,
      }
    );

    return {
      intro: createLiveAgentItem(
        "I will run a quick local test check and report back."
      ),
      steps: [
        {
          delayMs: 350,
          item: createLiveActivityItem(running),
        },
        {
          delayMs: 900,
          item: createLiveActivityItem(completed),
        },
      ],
      final: createLiveAgentItem(
        "Local tests completed successfully. I can continue with targeted fixes or add more coverage if you want."
      ),
    };
  }

  if (
    normalizedMessage.includes("find") ||
    normalizedMessage.includes("search") ||
    normalizedMessage.includes("where")
  ) {
    const running = createLiveActivity(
      "codebase_search",
      "codebase_search",
      "running",
      {
        query: message,
        path: "src/",
      },
      {}
    );
    const completed = createLiveActivity(
      "codebase_search",
      "codebase_search",
      "completed",
      {
        query: message,
        path: "src/",
      },
      {
        success: true,
        results: [
          {
            file: "src/components/Button/index.tsx",
            line: 12,
            content: "export interface ButtonProps {",
          },
          {
            file: "src/components/Button/Button.scss",
            line: 3,
            content: ".btn { display: inline-flex; }",
          },
        ],
        total_matches: 2,
      }
    );

    return {
      intro: createLiveAgentItem(
        "Understood. I am searching the codebase first."
      ),
      steps: [
        {
          delayMs: 300,
          item: createLiveActivityItem(running),
        },
        {
          delayMs: 700,
          item: createLiveActivityItem(completed),
        },
      ],
      final: createLiveAgentItem(
        "I found relevant locations and can now inspect or patch them in the next step."
      ),
    };
  }

  const readRunning = createLiveActivity(
    "read_file",
    "read_file",
    "running",
    {
      path: "src/components/Button/index.tsx",
    },
    {}
  );
  const readCompleted = createLiveActivity(
    "read_file",
    "read_file",
    "completed",
    {
      path: "src/components/Button/index.tsx",
    },
    {
      success: true,
      content:
        "import React from 'react';\n\ninterface ButtonProps {\n  children: ReactNode;\n}\n\nexport function Button({ children }: ButtonProps) {\n  return <button>{children}</button>;\n}",
      file_path: "src/components/Button/index.tsx",
    }
  );

  const editRunning = createLiveActivity(
    "edit_file",
    "edit_file",
    "running",
    {
      path: "src/components/Button/index.tsx",
      old_string: "interface ButtonProps {",
      new_string: "interface ButtonProps {\n  loading?: boolean;",
    },
    {}
  );
  const editCompleted = createLiveActivity(
    "edit_file",
    "edit_file",
    "completed",
    {
      path: "src/components/Button/index.tsx",
      old_string: "interface ButtonProps {",
      new_string: "interface ButtonProps {\n  loading?: boolean;",
    },
    {
      success: true,
      diff: "--- a/src/components/Button/index.tsx\n+++ b/src/components/Button/index.tsx\n@@ -1,6 +1,7 @@\n interface ButtonProps {\n+  loading?: boolean;\n   children: ReactNode;\n }",
      file_path: "src/components/Button/index.tsx",
      lines_added: 1,
      lines_removed: 0,
    }
  );

  return {
    intro: createLiveAgentItem(
      "Got it. I will inspect and patch the related code now."
    ),
    steps: [
      {
        delayMs: 280,
        item: createLiveActivityItem(readRunning),
      },
      {
        delayMs: 620,
        item: createLiveActivityItem(readCompleted),
      },
      {
        delayMs: 380,
        item: createLiveActivityItem(editRunning),
      },
      {
        delayMs: 820,
        item: createLiveActivityItem(editCompleted),
      },
    ],
    final: createLiveAgentItem(
      "I finished a local mock edit flow. You can continue chatting to trigger another event sequence."
    ),
  };
}

export async function waitMilliseconds(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}
