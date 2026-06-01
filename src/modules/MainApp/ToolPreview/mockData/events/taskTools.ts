import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { MOCK_MANAGE_TODO_12_ITEMS, createEvent } from "../shared";

export const taskToolsEvents: Record<string, SessionEvent> = {
  manage_todo: createEvent(
    "manage_todo",
    {
      todos: [...MOCK_MANAGE_TODO_12_ITEMS],
    },
    {
      success: {
        todos: [...MOCK_MANAGE_TODO_12_ITEMS],
        wasMerge: true,
      },
    }
  ),

  mcp_tool: createEvent(
    "query_database",
    {
      server: "postgres-mcp",
      query:
        "SELECT id, name, email FROM users WHERE active = true ORDER BY created_at DESC LIMIT 10",
      database: "production",
    },
    {
      success: true,
      rows: [
        { id: 1, name: "Alice Chen", email: "alice@example.com" },
        { id: 2, name: "Bob Martinez", email: "bob@example.com" },
        { id: 3, name: "Carol Wu", email: "carol@example.com" },
      ],
      row_count: 3,
      execution_time_ms: 42,
    }
  ),

  manage_story: createEvent(
    "manage_story",
    {
      action: "list",
    },
    {
      content: [
        "- **Chat panel visual polish** (slug: chat-panel-visual-polish) — in_progress · high",
        "- **Agent org onboarding** (slug: agent-org-onboarding) — planned · medium",
        "- **Work item scheduling** (slug: work-item-scheduling) — backlog · medium",
        "- **Marketplace source selector** (slug: marketplace-source-selector) — in_review · high",
        "- **Key Vault cleanup** (slug: key-vault-cleanup) — completed · low",
        "- **Simulator replay parity** (slug: simulator-replay-parity) — planned · high",
        "- **Project manager QA** (slug: project-manager-qa) — backlog · medium",
      ].join("\n"),
    }
  ),

  manage_work_item: createEvent(
    "manage_work_item",
    {
      action: "list_items",
      project_slug: "chat-panel-visual-polish",
    },
    {
      content: [
        "- **Unify project list row style** [CP-101] — completed · high · @frontend",
        "- **Add CRUD trailing indicators** [CP-102] — in_review · high · @frontend",
        "- **Update Built-in Tool Playground fixtures** [CP-103] — in_progress · medium · @frontend",
        "- **Verify simulator replay icons** [CP-104] — planned · medium · @qa",
        "- **Remove legacy action-specific icons** [CP-105] — completed · high · @frontend",
        "- **Document list row rendering contract** [CP-106] — backlog · low · @docs",
        "- **Run visual regression pass** [CP-107] — planned · medium · @qa",
      ].join("\n"),
    }
  ),

  worktree: createEvent(
    "worktree",
    {
      action: "add",
      branch: "feature/auth-refactor",
      base_ref: "main",
    },
    {
      success: true,
      reused: false,
      branch: "feature/auth-refactor",
      path: "/Users/developer/Documents/GitHub/orgii_frontend/.orgii/worktrees/feature/auth-refactor",
      base: "main",
      content: [
        "Created worktree at `/Users/developer/Documents/GitHub/orgii_frontend/.orgii/worktrees/feature/auth-refactor`",
        "Branch: `feature/auth-refactor`",
        "Base: `main`",
        "",
        "All file operations now target this worktree. Use `leave` to return.",
      ].join("\n"),
    }
  ),

  turn_summary: createEvent(
    "turn_summary",
    { toolCalls: 16, wallTimeSecs: 68 },
    {
      observation: `Completed the auth refactor. Key changes:

- Extracted token refresh into \`AuthService\` with a singleton-promise lock to eliminate race conditions.
- Consolidated \`useAuth\` and \`AuthContext\` — the hook is now a thin wrapper around the service.
- Added \`useRequireAuth()\` that redirects to \`/login\` on session expiry, replacing 7 ad-hoc inline checks.
- Updated axios interceptor to call \`AuthService.refresh()\` directly (no more duplicate requests).

All 42 existing auth integration tests pass. TypeScript clean.`,
    },
    "tool_call",
    "completed"
  ),

  // Single shell wait_for — build succeeded, pattern matched, exit 0.
  // Renders as TitleOnly: "Waited for 1 terminal process" header only.
  await_output: createEvent(
    "await_output",
    {
      command: "wait_for",
      handles: ["48291"],
      pattern: "Build succeeded|error\\[",
      block_until_ms: 90000,
      tail_lines: 50,
    },
    {
      output:
        '[48291: succeeded]\nawaitMeta::{"count":1,"items":[{"handle":"48291","jobKind":"shell","status":"succeeded","exitCode":0,"patternMatched":true,"matchLine":"Build succeeded"}]}\n--- [48291] last 50 lines ---\nCompiling orgii-app v0.1.0\n    Checking agent_core v0.1.0\n    Finished dev profile [unoptimized + debuginfo] target(s) in 42.8s\nBuild succeeded',
    }
  ),

  // Single subagent monitor — agent peeks at a delegate that finished.
  // Renders as TitleOnly: "Checked 1 Subagent" header only.
  await_output_subagent: createEvent(
    "await_output",
    {
      command: "monitor",
      handles: ["agent-builtin:explore-abc123"],
      tail_lines: 50,
    },
    {
      output:
        '[agent-builtin:explore-abc123: succeeded]\nawaitMeta::{"count":1,"items":[{"handle":"agent-builtin:explore-abc123","jobKind":"subagent","status":"succeeded","exitCode":0}]}\n--- [agent-builtin:explore-abc123] last 50 lines ---\nSubagent finished. Found 7 matching files across 3 feature areas.\n\nsrc/modules/MainApp/Integrations/index.tsx\nsrc/features/auth/KeyVaultWizard.tsx\nsrc/features/session/SessionCreator.tsx',
    }
  ),

  // Multi-handle monitor — shell + subagent together. Exercises the
  // "N terminal processes, M Subagents" summary branch in i18n.
  await_output_multi: createEvent(
    "await_output",
    {
      command: "monitor",
      handles: ["48291", "agent-builtin:explore-abc123", "52107"],
      tail_lines: 20,
    },
    {
      output:
        '[48291: running] [agent-builtin:explore-abc123: succeeded] [52107: failed]\nawaitMeta::{"count":3,"items":[{"handle":"48291","jobKind":"shell","status":"running","waitedMs":0},{"handle":"agent-builtin:explore-abc123","jobKind":"subagent","status":"succeeded","exitCode":0},{"handle":"52107","jobKind":"shell","status":"failed","exitCode":1}]}\n--- [48291] last 20 lines ---\n[webpack] compiling...\n--- [agent-builtin:explore-abc123] last 20 lines ---\nSubagent finished. Found 7 matching files.\n--- [52107] last 20 lines ---\nerror[E0308]: mismatched types\n  --> src/lib.rs:42:5',
    }
  ),

  // Listing — renders as ToolCallBlock with stack list of jobs (mirrors
  // manage_workspace > list).
  await_output_list: createEvent(
    "await_output",
    {
      command: "list",
    },
    {
      output:
        '[background jobs]\nawaitMeta::{"command":"list","status":"succeeded","count":3,"items":[{"handle":"48291","kind":"shell","status":"running","ageMs":42800,"label":"npm run dev"},{"handle":"agent-builtin:explore-abc123","kind":"subagent","status":"succeeded","ageMs":15200,"label":"Explorer"},{"handle":"52107","kind":"shell","status":"failed","ageMs":8100,"label":"cargo test"}]}\nHANDLE          KIND              STATUS      AGE       LABEL\n48291           shell             running     42s       npm run dev\nagent-builtin:explore-abc123 subagent         succeeded  15s       Explorer\n52107           shell             failed      8s        cargo test',
    }
  ),

  tool_call: createEvent(
    "custom_internal_tool",
    {
      action: "process",
      input: "raw-data-payload",
      options: { format: "json", verbose: true },
    },
    {
      success: true,
      output: "Processed 128 records in 0.3s",
    }
  ),
};
