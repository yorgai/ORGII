/**
 * Mock Data Registry for Tool Event Preview
 *
 * Provides example SessionEvent data for all registered event types.
 * Each mock includes realistic data that demonstrates the component's rendering.
 *
 * Sync rule: every key in COMPONENT_LOADERS (events/index.ts) must have a
 * corresponding entry in MOCK_EVENT_DATA and CONTEXT_CONFIG. The dev-mode
 * check at the bottom of this file enforces this at runtime.
 *
 * Event data is organized by domain in events/:
 *   - events/fileOps.ts      — read_file, edit_file, apply_patch, delete_file, list_dir, manage_workspace
 *   - events/codingTools.ts  — query_lsp, run_shell, code_search, glob_file_search
 *   - events/webBrowser.ts   — web_search, browser, internal_browser
 *   - events/agentMessages.ts — agent_message, thinking, user, ask_*, subagent, suggest_*
 *   - events/taskTools.ts    — manage_todo, mcp_tool, worktree, turn_summary, await_output*, tool_call
 */
import type { EventDisplayStatus } from "@src/engines/SessionCore/core/types";
import { getCliUiCanonical } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";

import { MOCK_EVENT_DATA } from "./events";
import { generateMockId } from "./shared";

export { MOCK_EVENT_DATA } from "./events";
export {
  MOCK_ACTIVE_PROCESSES,
  MOCK_FILE_CHANGES,
  MOCK_QUEUED_MESSAGES,
} from "./playgroundMocks";
export type { SubagentPlaygroundPreset } from "./shared";
export {
  generateMockId,
  MOCK_MANAGE_TODO_12_ITEMS,
  SUBAGENT_PLAYGROUND_PRESETS,
} from "./shared";

// ============================================
// Accessor helpers
// ============================================

const INTERNAL_MOCK_KEYS = new Set<string>();

/** Get all available event types */
export function getAvailableEventTypes(): string[] {
  return Object.keys(MOCK_EVENT_DATA).filter(
    (key) => !INTERNAL_MOCK_KEYS.has(key)
  );
}

/** Get mock data for a specific event type */
export function getMockEventData(
  eventType: string
): import("@src/engines/SessionCore/core/types").SessionEvent | null {
  return MOCK_EVENT_DATA[eventType] ?? null;
}

/** Create a fresh copy of mock data (with new IDs) */
export function createFreshMockData(
  eventType: string
): import("@src/engines/SessionCore/core/types").SessionEvent | null {
  const template = MOCK_EVENT_DATA[eventType];
  if (!template) return null;

  const id = generateMockId();
  return {
    ...template,
    chunk_id: id,
    id,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Rich mock when a template exists; otherwise a minimal skeleton (registry tools
 * without a dedicated mock entry). Used by Tool Registry playground and JSON preview.
 *
 * Lookup order:
 * 1. Direct match on `toolName` in MOCK_EVENT_DATA (e.g. `manage_workspace`)
 * 2. Resolve via CLI alias registry to UI canonical (e.g. `run_shell` → `run_shell`)
 * 3. Fall back to a minimal skeleton
 */
export function createPlaygroundEventForToolName(
  toolName: string,
  status: EventDisplayStatus
): import("@src/engines/SessionCore/core/types").SessionEvent {
  const direct = createFreshMockData(toolName);
  if (direct) {
    return { ...direct, functionName: toolName, displayStatus: status };
  }
  const uiCanonical = getCliUiCanonical(toolName);
  const fresh = createFreshMockData(uiCanonical);
  if (fresh) {
    return { ...fresh, functionName: toolName, displayStatus: status };
  }
  const id = generateMockId();
  return {
    chunk_id: id,
    id,
    sessionId: "mock-session-001",
    actionType: "tool_call",
    functionName: toolName,
    uiCanonical: "",
    args: {},
    result: { success: true },
    source: "assistant",
    displayText: "",
    displayStatus: status,
    displayVariant: "tool_call",
    activityStatus: "agent",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Build a linear list of mock events for DevTools multi-select preview.
 */
export function buildPlaygroundEventsForTypes(
  orderedTypes: string[],
  status: EventDisplayStatus
): import("@src/engines/SessionCore/core/types").SessionEvent[] {
  const out: import("@src/engines/SessionCore/core/types").SessionEvent[] = [];
  for (const eventType of orderedTypes) {
    const fresh = createFreshMockData(eventType);
    if (fresh) {
      out.push({ ...fresh, displayStatus: status });
    }
  }
  return out;
}

/**
 * Multi-select preview for Tool Registry: ordered tool names from Rust `list_all_tools`.
 * Uses rich mock when {@link createFreshMockData} has a template; otherwise a minimal skeleton.
 */
export function buildPlaygroundEventsForRegistryToolNames(
  orderedNames: string[],
  status: EventDisplayStatus
): import("@src/engines/SessionCore/core/types").SessionEvent[] {
  return orderedNames.map((name) =>
    createPlaygroundEventForToolName(name, status)
  );
}

interface RichCommandPreviewOverride {
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

type CommandPreviewOverride =
  | Record<string, unknown>
  | RichCommandPreviewOverride;

const COMMAND_PREVIEW_OVERRIDES: Record<
  string,
  Record<string, CommandPreviewOverride>
> = {
  read_file: {
    read_image: {
      path: "docs/screenshots/dashboard.png",
    },
    read_pdf: {
      path: "docs/architecture/design-spec.pdf",
    },
  },
  code_search: {
    grep: {
      action: "grep",
      pattern: "TODO|FIXME|HACK",
      query: "TODO|FIXME|HACK",
    },
    find_files: {
      action: "find_files",
      pattern: "tsconfig",
      query: "tsconfig",
    },
    glob: {
      action: "glob",
      pattern: "src/**/*.test.tsx",
      query: "src/**/*.test.tsx",
    },
    symbols: {
      action: "symbols",
      pattern: "handleSubmit",
      query: "handleSubmit",
    },
    check_status: {
      action: "check_status",
      pattern: undefined,
      query: undefined,
    },
  },
  run_shell: {
    kill: {
      kill_handle: "bg_3",
      command: undefined,
    },
  },
  worktree: {
    add: {
      action: "add",
      branch: "feature/auth-refactor",
      base_ref: "main",
    },
    leave: {
      action: "leave",
      remove: true,
      branch: undefined,
      base_ref: undefined,
    },
    list: {
      action: "list",
      branch: undefined,
      base_ref: undefined,
    },
  },
  manage_workspace: {
    list: { action: "list" },
    add: { action: "add", path: "/Users/developer/Work/new-project" },
    clone: {
      action: "clone",
      url: "https://github.com/YORG-AI/orgii.git",
      target_dir: "/Users/developer/Documents/GitHub",
    },
    create: {
      action: "create",
      name: "fresh-workspace",
      target_dir: "/Users/developer/Work",
      git: true,
    },
    remove: { action: "remove", path: "/Users/developer/Desktop/scratch-pad" },
  },
  manage_story: {
    list: { args: { action: "list" } },
    create: {
      args: {
        action: "create",
        name: "Chat panel CRUD affordances",
        priority: "high",
        status: "planned",
      },
      result: { content: "Created project 'Chat panel CRUD affordances'" },
    },
    update: {
      args: {
        action: "update",
        slug: "chat-panel-visual-polish",
        name: "Chat panel visual polish",
        status: "in_review",
      },
      result: { content: "Updated project 'Chat panel visual polish'" },
    },
    delete: {
      args: {
        action: "delete",
        slug: "legacy-project-icons",
      },
      result: { content: "Deleted project 'Legacy project icons'" },
    },
    find: {
      args: { action: "find", query: "chat panel" },
      result: {
        content: [
          '- [CP-102] "Add CRUD trailing indicators" — project: Chat panel visual polish',
          "- Chat panel visual polish (slug: chat-panel-visual-polish) — in_progress · high",
          '- [CP-105] "Remove legacy action-specific icons" — project: Chat panel visual polish',
        ].join("\n"),
      },
    },
    list_items: {
      args: { action: "list_items", slug: "chat-panel-visual-polish" },
      result: {
        content: [
          "- **Unify project list row style** [CP-101] — completed · high · @frontend",
          "- **Add CRUD trailing indicators** [CP-102] — in_review · high · @frontend",
          "- **Update Built-in Tool Playground fixtures** [CP-103] — in_progress · medium · @frontend",
        ].join("\n"),
      },
    },
  },
  manage_work_item: {
    list: {
      args: { action: "list", project_slug: "chat-panel-visual-polish" },
    },
    list_items: {
      args: { action: "list_items", project_slug: "chat-panel-visual-polish" },
    },
    create: {
      args: {
        action: "create",
        project_slug: "chat-panel-visual-polish",
        title: "Add plus icon for created rows",
        priority: "high",
      },
      result: {
        content: "Created work item 'Add plus icon for created rows' [CP-108]",
      },
    },
    create_item: {
      args: {
        action: "create_item",
        project_slug: "chat-panel-visual-polish",
        title: "Add plus icon for created rows",
        priority: "high",
      },
      result: {
        content: "Created work item 'Add plus icon for created rows' [CP-108]",
      },
    },
    update: {
      args: {
        action: "update",
        project_slug: "chat-panel-visual-polish",
        short_id: "CP-102",
        title: "Add CRUD trailing indicators",
        status: "in_review",
      },
      result: {
        content: "Updated work item 'Add CRUD trailing indicators' [CP-102]",
      },
    },
    update_item: {
      args: {
        action: "update_item",
        project_slug: "chat-panel-visual-polish",
        short_id: "CP-102",
        title: "Add CRUD trailing indicators",
        status: "in_review",
      },
      result: {
        content: "Updated work item 'Add CRUD trailing indicators' [CP-102]",
      },
    },
    delete: {
      args: {
        action: "delete",
        project_slug: "chat-panel-visual-polish",
        short_id: "CP-099",
      },
      result: {
        content: "Deleted work item 'Legacy folder-kanban override' [CP-099]",
      },
    },
    delete_item: {
      args: {
        action: "delete_item",
        project_slug: "chat-panel-visual-polish",
        short_id: "CP-099",
      },
      result: {
        content: "Deleted work item 'Legacy folder-kanban override' [CP-099]",
      },
    },
  },
};

/**
 * Build one preview event per selected command for a given tool.
 * Each event copies the tool's base mock and patches `args.action` with the command name.
 * Per-command arg overrides (e.g. kill_handle for run_shell/kill) are applied when available.
 */
export function buildPlaygroundEventsForToolCommands(
  toolName: string,
  commands: string[],
  status: EventDisplayStatus
): import("@src/engines/SessionCore/core/types").SessionEvent[] {
  return commands.map((commandName) => {
    const base = createPlaygroundEventForToolName(toolName, status);
    const override = COMMAND_PREVIEW_OVERRIDES[toolName]?.[commandName];
    const argsOverride = getCommandArgsOverride(override);
    const resultOverride = getCommandResultOverride(override);
    return {
      ...base,
      chunk_id: generateMockId(),
      id: generateMockId(),
      args: { ...base.args, action: commandName, ...argsOverride },
      result: { ...base.result, ...resultOverride },
    };
  });
}

function getCommandArgsOverride(
  override: CommandPreviewOverride | undefined
): Record<string, unknown> {
  if (!override) return {};
  if (isRichCommandPreviewOverride(override)) return override.args ?? {};
  return override;
}

function getCommandResultOverride(
  override: CommandPreviewOverride | undefined
): Record<string, unknown> {
  if (!override) return {};
  if (isRichCommandPreviewOverride(override)) return override.result ?? {};
  return {};
}

function isRichCommandPreviewOverride(
  override: CommandPreviewOverride
): override is RichCommandPreviewOverride {
  return "args" in override || "result" in override;
}

// ============================================
// Dev-mode sync check
//
// Detects drift between COMPONENT_LOADERS (events/index.ts) and this file.
// Logs a console.warn for any event type registered in the renderer but
// missing a mock entry here, so new events are caught immediately during
// development.
//
// The check runs once at module load. It imports lazily so it never ships
// in production and has zero runtime cost in prod builds.
// ============================================

if (process.env.NODE_ENV === "development") {
  import("@src/engines/SessionCore/rendering/registry/events")
    .then(({ COMPONENT_LOADERS, CONTEXT_CONFIG }) => {
      const mockKeys = new Set(Object.keys(MOCK_EVENT_DATA));
      const configKeys = new Set(Object.keys(CONTEXT_CONFIG));
      const missing: {
        key: string;
        missingMock: boolean;
        missingConfig: boolean;
      }[] = [];

      for (const key of Object.keys(COMPONENT_LOADERS)) {
        const missingMock = !mockKeys.has(key);
        const missingConfig = !configKeys.has(key);
        if (missingMock || missingConfig) {
          missing.push({ key, missingMock, missingConfig });
        }
      }

      if (missing.length > 0) {
        console.warn(
          "[Playground sync] The following event types are registered in COMPONENT_LOADERS " +
            "but are missing entries. Add them to keep Playground in sync:\n" +
            missing
              .map(({ key, missingMock, missingConfig }) => {
                const where: string[] = [];
                if (missingMock)
                  where.push("MOCK_EVENT_DATA (mockData/index.ts)");
                if (missingConfig)
                  where.push("CONTEXT_CONFIG (events/index.ts)");
                return `  • ${key}: missing in ${where.join(" and ")}`;
              })
              .join("\n")
        );
      }
    })
    .catch(() => {
      // Ignore import errors during hot-reload
    });
}
