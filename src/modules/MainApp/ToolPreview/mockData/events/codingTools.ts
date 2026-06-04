import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { createEvent } from "../shared";

export const codingToolsEvents: Record<string, SessionEvent> = {
  query_lsp: createEvent(
    "query_lsp",
    {
      action: "diagnostics",
      paths: ["src/engines/SessionCore/ui/blocks/ToolCallBlock/index.tsx"],
    },
    {
      success: true,
      results: [
        {
          file: "src/engines/SessionCore/ui/blocks/ToolCallBlock/index.tsx",
          line: 42,
          content:
            "Type 'string' is not assignable to type 'ToolCallBlockProps'.",
        },
        {
          file: "src/engines/SessionCore/ui/blocks/ToolCallBlock/index.tsx",
          line: 87,
          content:
            "Property 'iconOverride' does not exist on type 'IntrinsicAttributes'.",
        },
        {
          file: "src/engines/SessionCore/ui/blocks/ToolCallBlock/helpers.ts",
          line: 135,
          content:
            "Argument of type 'unknown' is not assignable to parameter of type 'string'.",
        },
        {
          file: "src/engines/SessionCore/ui/blocks/ToolCallBlock/helpers.ts",
          line: 289,
          content:
            "Function 'parseManageWorkspaceResult' is declared but never used.",
        },
        {
          file: "src/engines/SessionCore/rendering/registry/toolCategories.ts",
          line: 168,
          content:
            "'manage_workspace' is not assignable to type 'ActivitySummaryCategory'.",
        },
      ],
      total_matches: 5,
    }
  ),

  run_shell: createEvent(
    "run_shell",
    {
      command:
        "cd /Users/developer/Documents/GitHub/orgii_frontend && npm run tauri:check && npx tsc --noEmit --pretty false && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings && echo 'All checks passed successfully'",
      cwd: "/Users/developer/Documents/GitHub/orgii_frontend",
      description:
        "Run full lint, typecheck, and clippy suite after key vault refactor to make sure nothing is broken across Rust and TypeScript layers",
    },
    {
      success: true,
      output: `> orgii@0.0.0 tauri:check
> cargo check --manifest-path src-tauri/Cargo.toml --all-targets

    Checking orgii-app v0.0.0 (/Users/developer/Documents/GitHub/orgii_frontend/src-tauri)
    Finished dev profile [unoptimized + debuginfo] target(s) in 18.42s

> npx tsc --noEmit --pretty false

(no output — exit 0)

Summary: tauri IPC crates + frontend typecheck clean.`,
      exit_code: 0,
      execution_time: 22140,
    }
  ),

  code_search: createEvent(
    "code_search",
    {
      action: "grep",
      pattern: "useState",
      query: "useState",
      path: "src/",
    },
    {
      success: true,
      results: [
        {
          file: "src/hooks/useAuth.ts",
          line: 5,
          content: "const [user, setUser] = useState<User | null>(null);",
        },
        {
          file: "src/components/LoginForm/index.tsx",
          line: 12,
          content: "const [email, setEmail] = useState('');",
        },
        {
          file: "src/components/LoginForm/index.tsx",
          line: 13,
          content: "const [password, setPassword] = useState('');",
        },
        {
          file: "src/store/session/atoms.ts",
          line: 8,
          content: "const [sessions, setSessions] = useState<Session[]>([]);",
        },
      ],
      total_matches: 4,
    }
  ),

  glob_file_search: createEvent(
    "glob_file_search",
    {
      pattern: "src/**/*.{ts,tsx,scss,json,md}",
      path: "src/",
    },
    {
      success: true,
      files: [
        "src/components/Button/index.tsx",
        "src/components/Button/Button.scss",
        "src/components/Input/index.tsx",
        "src/components/Modal/Modal.test.tsx",
        "src/hooks/useAuth.ts",
        "src/hooks/useTheme.ts",
        "src/api/client.ts",
        "src/api/http/market/types.ts",
        "src/config/settings.json",
        "src/config/routes.ts",
        "src/store/session/atoms.ts",
        "src/i18n/locales/en/common.json",
        "src/util/format.ts",
        "src/util/date.ts",
        "src/types/session/activity.ts",
        "src/features/ChatPanel/index.tsx",
        "src/features/ChatPanel/ChatHistory/types.ts",
        "src/modules/WorkStation/Launchpad/config.ts",
        "src/modules/shared/layouts/AppLayout.tsx",
        "docs/architecture/overview.md",
      ],
      total: 20,
    }
  ),
};
