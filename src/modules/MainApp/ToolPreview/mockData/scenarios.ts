/**
 * Preset Chat Session Scenarios
 *
 * Each scenario represents a realistic chat flow combining multiple event types.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { MOCK_EVENT_DATA, MOCK_MANAGE_TODO_12_ITEMS } from "./index";

export type MockChatItemType = "user" | "agent" | "activity";

export interface MockChatItem {
  type: MockChatItemType;
  content?: string;
  eventData?: SessionEvent;
}

export interface SessionScenario {
  id: string;
  name: string;
  description: string;
  items: MockChatItem[];
}

function createScenarioEvent(
  eventType: keyof typeof MOCK_EVENT_DATA,
  overrides?: Partial<SessionEvent>
): SessionEvent {
  const template = MOCK_EVENT_DATA[eventType];
  const id = `${eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    ...template,
    id,
    chunk_id: id,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Preset scenarios for session simulation
 */
export const SESSION_SCENARIOS: SessionScenario[] = [
  {
    id: "file-edit-flow",
    name: "File Edit Flow",
    description: "Read a file, make edits, and confirm changes",
    items: [
      {
        type: "user",
        content: "Can you update the Button component to add a loading state?",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("read_file"),
      },
      {
        type: "agent",
        content:
          "I've read the Button component. I'll add a loading state with a spinner. Let me make the changes.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("edit_file", {
          args: {
            path: "src/components/Button/index.tsx",
            old_string: "interface ButtonProps {",
            new_string: `interface ButtonProps {
  loading?: boolean;`,
          },
          result: {
            success: true,
            diff: `--- a/src/components/Button/index.tsx
+++ b/src/components/Button/index.tsx
@@ -5,6 +5,7 @@ import "./Button.scss";
 interface ButtonProps {
+  loading?: boolean;
   children: ReactNode;
   variant?: "primary" | "secondary" | "ghost";`,
            file_path: "src/components/Button/index.tsx",
            lines_added: 1,
            lines_removed: 0,
          },
        }),
      },
      {
        type: "agent",
        content:
          "Done! I've added a `loading` prop to the Button component. When `loading` is true, it will show a spinner and disable the button.",
      },
    ],
  },

  {
    id: "search-and-refactor",
    name: "Search and Refactor",
    description: "Search for code patterns and refactor across files",
    items: [
      {
        type: "user",
        content: "Find all usages of the deprecated useAuth hook",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("code_search", {
          args: { query: "useAuth", path: "src/" },
        }),
      },
      {
        type: "agent",
        content:
          "I found 3 files using `useAuth`. Let me read each one to understand the usage patterns.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("read_file", {
          args: { path: "src/components/LoginForm/index.tsx" },
          result: {
            success: true,
            content: `import { useAuth } from '@src/hooks/useAuth';

export function LoginForm() {
  const { login, isLoading } = useAuth();
  // ...
}`,
            file_path: "src/components/LoginForm/index.tsx",
          },
        }),
      },
      {
        type: "activity",
        eventData: createScenarioEvent("read_file", {
          args: { path: "src/pages/Dashboard.tsx" },
          result: {
            success: true,
            content: `import { useAuth } from '@src/hooks/useAuth';

export function Dashboard() {
  const { user, logout } = useAuth();
  // ...
}`,
            file_path: "src/pages/Dashboard.tsx",
          },
        }),
      },
      {
        type: "agent",
        content:
          "I've analyzed the usages. The hook is used for `login`, `logout`, `user`, and `isLoading`. Should I proceed with creating a migration plan?",
      },
    ],
  },

  {
    id: "terminal-testing",
    name: "Terminal Testing Flow",
    description: "Run tests, check coverage, and fix issues",
    items: [
      {
        type: "user",
        content: "Run the tests and show me the coverage report",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("run_shell"),
      },
      {
        type: "agent",
        content:
          "All 12 tests passed! The overall coverage is 87.5%. I notice that `src/components/Button` has lower coverage. Would you like me to add more tests?",
      },
      {
        type: "user",
        content: "Yes, please add tests for the Button component",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("read_file", {
          args: { path: "src/components/Button/__tests__/Button.test.tsx" },
        }),
      },
      {
        type: "activity",
        eventData: createScenarioEvent("edit_file", {
          args: { path: "src/components/Button/__tests__/Button.test.tsx" },
          result: {
            success: true,
            diff: `--- a/src/components/Button/__tests__/Button.test.tsx
+++ b/src/components/Button/__tests__/Button.test.tsx
@@ -20,4 +20,14 @@ describe('Button', () => {
   it('should handle click events', () => {
     // existing test
   });
+
+  it('should show loading spinner when loading', () => {
+    render(<Button loading>Submit</Button>);
+    expect(screen.getByRole('progressbar')).toBeInTheDocument();
+  });
+
+  it('should be disabled when loading', () => {
+    render(<Button loading>Submit</Button>);
+    expect(screen.getByRole('button')).toBeDisabled();
+  });
 });`,
            file_path: "src/components/Button/__tests__/Button.test.tsx",
            lines_added: 10,
            lines_removed: 0,
          },
        }),
      },
      {
        type: "activity",
        eventData: createScenarioEvent("run_shell", {
          args: { command: "npm run test -- Button.test.tsx" },
          result: {
            success: true,
            output: `> jest Button.test.tsx

 PASS  src/components/Button/__tests__/Button.test.tsx
  Button
    ✓ should render correctly (12 ms)
    ✓ should handle click events (8 ms)
    ✓ should show loading spinner when loading (5 ms)
    ✓ should be disabled when loading (4 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total`,
            exit_code: 0,
          },
        }),
      },
      {
        type: "agent",
        content:
          "I've added 2 new tests for the loading state. All 4 tests in the Button test file are now passing.",
      },
    ],
  },

  {
    id: "planning-session",
    name: "Planning Session",
    description:
      "A session that involves thinking, planning, and task creation",
    items: [
      {
        type: "user",
        content:
          "I need to implement a new feature for user notifications. Can you help me plan this?",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("thinking"),
      },
      {
        type: "activity",
        eventData: createScenarioEvent("suggest_mode_switch", {
          args: {
            suggested_mode: "plan",
            reason:
              "This feature involves multiple components and would benefit from a structured plan",
          },
        }),
      },
      {
        type: "agent",
        content:
          "This is a substantial feature that touches multiple parts of the codebase. Let me create a task list to track our progress.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("manage_todo", {
          args: {
            todos: [...MOCK_MANAGE_TODO_12_ITEMS],
          },
          result: {
            success: {
              todos: [...MOCK_MANAGE_TODO_12_ITEMS],
              wasMerge: true,
            },
          },
        }),
      },
      {
        type: "agent",
        content:
          "I've created a task list with 12 items. Should I start implementing the NotificationContext first?",
      },
    ],
  },

  {
    id: "full-agent-session",
    name: "Full Agent Session",
    description: "A complete session with file search and edits",
    items: [
      {
        type: "user",
        content: "Help me set up a new API endpoint for user profiles",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("glob_file_search", {
          args: { pattern: "**/api/**/*.ts", path: "src/" },
        }),
      },
      {
        type: "activity",
        eventData: createScenarioEvent("read_file", {
          args: { path: "src/api/users.ts" },
        }),
      },
      {
        type: "activity",
        eventData: createScenarioEvent("edit_file", {
          args: { path: "src/api/profiles.ts" },
          result: {
            success: true,
            diff: `--- /dev/null
+++ b/src/api/profiles.ts
@@ -0,0 +1,25 @@
+import { api } from './client';
+
+export interface UserProfile {
+  id: string;
+  name: string;
+  email: string;
+  avatar?: string;
+}
+
+export async function getProfile(userId: string) {
+  return api.get<UserProfile>(\`/profiles/\${userId}\`);
+}
+
+export async function updateProfile(userId: string, data: Partial<UserProfile>) {
+  return api.put<UserProfile>(\`/profiles/\${userId}\`, data);
+}`,
            file_path: "src/api/profiles.ts",
            lines_added: 25,
            lines_removed: 0,
          },
        }),
      },
      {
        type: "agent",
        content:
          "I've created the user profiles API endpoint with `getProfile` and `updateProfile` functions. The new file is at `src/api/profiles.ts`.",
      },
    ],
  },

  {
    id: "error-handling",
    name: "Error Handling",
    description: "Session demonstrating error states and recovery",
    items: [
      {
        type: "user",
        content: "Deploy the application to production",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("run_shell", {
          args: { command: "npm run build" },
          result: {
            success: false,
            output: `> project@1.0.0 build
> tsc && vite build

src/api/client.ts:45:3 - error TS2322: Type 'string' is not assignable to type 'number'.

45   timeout: "30000",
     ~~~~~~~

Found 1 error in src/api/client.ts:45`,
            exit_code: 1,
          },
          displayStatus: "completed",
        }),
      },
      {
        type: "agent",
        content:
          "The build failed due to a TypeScript error in `src/api/client.ts`. The `timeout` value should be a number, not a string. Let me fix this.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("edit_file", {
          args: {
            path: "src/api/client.ts",
            old_string: 'timeout: "30000"',
            new_string: "timeout: 30000",
          },
          result: {
            success: true,
            diff: `--- a/src/api/client.ts
+++ b/src/api/client.ts
@@ -42,7 +42,7 @@ export const api = axios.create({
   baseURL: API_BASE_URL,
   headers: {
     'Content-Type': 'application/json',
   },
-  timeout: "30000",
+  timeout: 30000,
 });`,
            file_path: "src/api/client.ts",
            lines_added: 1,
            lines_removed: 1,
          },
        }),
      },
      {
        type: "activity",
        eventData: createScenarioEvent("run_shell", {
          args: { command: "npm run build" },
          result: {
            success: true,
            output: `> project@1.0.0 build
> tsc && vite build

vite v5.0.0 building for production...
✓ 234 modules transformed.
dist/index.html                  0.45 kB │ gzip:  0.29 kB
dist/assets/index-abc123.css    12.34 kB │ gzip:  3.21 kB
dist/assets/index-def456.js    156.78 kB │ gzip: 48.92 kB
✓ built in 3.45s`,
            exit_code: 0,
          },
        }),
      },
      {
        type: "agent",
        content:
          "Fixed the TypeScript error and the build succeeded. The application is now ready for deployment.",
      },
    ],
  },
];

/**
 * Get all available scenarios
 */
export function getAvailableScenarios(): SessionScenario[] {
  return SESSION_SCENARIOS;
}

export const EXTENDED_SESSION_SCENARIOS: SessionScenario[] = [
  {
    id: "agent-tool-flow",
    name: "Agent Tool — Subagent Orchestration",
    description:
      "Primary agent delegates tasks to specialist subagents via the unified agent tool",
    items: [
      {
        type: "user",
        content:
          "Audit the codebase for circular imports and save the findings to memory so you can reference them later.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("thinking"),
      },
      {
        type: "agent",
        content:
          "I'll run a codebase scan first, then hand the findings off to the memory specialist to persist them. Starting the explore subagent now.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("subagent", {
          args: {
            agent_id: "builtin:explore",
            prompt:
              "Find all TypeScript files that contain circular import chains. List each chain and the involved files.",
            fork: true,
          },
          result: {
            success: true,
            summary:
              "Detected 9 circular import chains. Worst offenders: engines/SessionCore/sync ↔ engines/SessionCore/hooks (4-hop cycle), store/session ↔ hooks/workspace (2-hop cycle).",
            chains_found: 9,
          },
        }),
      },
      {
        type: "agent",
        content:
          "Explore found 9 circular chains. Now storing the results in long-term memory via the memory specialist.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("subagent", {
          args: {
            agent_id: "builtin:memory-specialist",
            prompt:
              "Store architectural finding: 9 circular import chains detected in the codebase. Key cycles: engines/SessionCore/sync ↔ hooks (4-hop), store/session ↔ hooks/workspace (2-hop). Tag: #architecture #tech-debt",
            fork: false,
          },
          result: {
            success: true,
            summary: "Memory stored. 2 entries created under #architecture.",
            memory_ids: ["mem-arch-001", "mem-arch-002"],
          },
        }),
      },
      {
        type: "agent",
        content:
          "Done. The audit found **9 circular import chains** — I've saved the key findings to memory under `#architecture`. The worst cycle is `engines/SessionCore/sync ↔ hooks` (4-hop). Want me to create work items for the cleanup?",
      },
    ],
  },

  {
    id: "tool-result-persistence",
    name: "Tool Result Persistence — Large Output Truncated",
    description:
      "Agent tool returns a large result that is written to disk, shown as preview + file path",
    items: [
      {
        type: "user",
        content:
          "Do a full project audit — every file, line count, unused exports, and dependency graph.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("thinking"),
      },
      {
        type: "agent",
        content:
          "This will produce a large output. I'll delegate to the general agent with full tool access and let it run the complete audit.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("subagent", {
          args: {
            agent_id: "builtin:general",
            prompt:
              "Perform a full codebase audit: list every file, count lines, detect circular imports, and summarize dependencies.",
            fork: true,
          },
          result: {},
          displayStatus: "running",
        }),
      },
      {
        type: "activity",
        eventData: createScenarioEvent("subagent", {
          args: {
            agent_id: "builtin:general",
            prompt:
              "Perform a full codebase audit: list every file, count lines, detect circular imports, and summarize dependencies.",
            fork: true,
          },
          result: {
            success: true,
            truncated: true,
            preview:
              "Full audit complete. 1,247 files analyzed. 89,342 total lines.\n\nTop findings:\n- 9 circular import chains detected\n- 23 unused exports\n- 4 files exceed 600-line limit\n...[result truncated — 287KB]",
            result_path:
              "/Users/developer/projects/my-app/.orgii/tool-results/agent-audit-1712345678.txt",
            char_count: 294912,
          },
        }),
      },
      {
        type: "agent",
        content:
          "The audit is complete. The full output was 287KB — too large to hold in context, so it's been saved to `.orgii/tool-results/agent-audit-1712345678.txt`. Key highlights:\n\n- **1,247 files** analyzed, **89,342 lines** total\n- **9 circular import chains** detected\n- **23 unused exports** across 14 files\n- **4 files** exceed the 600-line limit\n\nWant me to drill into any of these findings?",
      },
    ],
  },

  {
    id: "agent-tool-running",
    name: "Agent Tool — Running State",
    description:
      "Shows the in-progress state of a subagent while it is still executing",
    items: [
      {
        type: "user",
        content: "Ask the memory specialist to recall everything about auth.",
      },
      {
        type: "activity",
        eventData: createScenarioEvent("subagent", {
          args: {
            agent_id: "builtin:memory-specialist",
            prompt:
              "Recall all stored memories tagged with #auth or related to authentication, session management, or token handling.",
            fork: false,
          },
          result: {},
          displayStatus: "running",
        }),
      },
    ],
  },
];

export function getAvailableExtendedScenarios(): SessionScenario[] {
  return [...SESSION_SCENARIOS, ...EXTENDED_SESSION_SCENARIOS];
}

/**
 * Get a specific scenario by ID
 */
export function getScenarioById(scenarioId: string): SessionScenario | null {
  return SESSION_SCENARIOS.find((s) => s.id === scenarioId) ?? null;
}
