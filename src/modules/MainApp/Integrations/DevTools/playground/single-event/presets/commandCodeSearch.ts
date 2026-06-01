import type { StatusPreset } from "../../types";

export const commandCodeSearchPresets: Record<string, StatusPreset[]> = {
  grep: [
    {
      key: "completed",
      label: "Completed (3 matches)",
      status: "completed",
      argsPatch: {
        action: "grep",
        pattern: "TODO|FIXME|HACK",
        query: "TODO|FIXME|HACK",
      },
      resultPatch: {
        success: true,
        total: 3,
        results: [
          {
            file: "src/hooks/useAuth.ts",
            line: 42,
            content: "// TODO: refresh token before expiry",
          },
          {
            file: "src/api/client.ts",
            line: 118,
            content: "// FIXME: retry logic silently swallows 429",
          },
          {
            file: "src/util/date.ts",
            line: 7,
            content: "// HACK: dayjs locale import order matters",
          },
        ],
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      argsPatch: {
        action: "grep",
        pattern: "TODO|FIXME|HACK",
        query: "TODO|FIXME|HACK",
      },
      resultPatch: {
        success: undefined,
        results: undefined,
        total: undefined,
      },
    },
    {
      key: "failed",
      label: "Failed",
      status: "failed",
      argsPatch: { action: "grep", pattern: "[invalid(regex" },
      resultPatch: { success: false },
    },
  ],
  find_files: [
    {
      key: "completed",
      label: "Completed (5 files)",
      status: "completed",
      argsPatch: {
        action: "find_files",
        pattern: "tsconfig",
        query: "tsconfig",
      },
      resultPatch: {
        success: true,
        total: 5,
        results: [
          { file: "tsconfig.json", line: 1, content: "tsconfig.json" },
          {
            file: "tsconfig.node.json",
            line: 1,
            content: "tsconfig.node.json",
          },
          {
            file: "tsconfig.app.json",
            line: 1,
            content: "tsconfig.app.json",
          },
          {
            file: "src-tauri/tsconfig.json",
            line: 1,
            content: "src-tauri/tsconfig.json",
          },
          {
            file: "packages/shared/tsconfig.json",
            line: 1,
            content: "packages/shared/tsconfig.json",
          },
        ],
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      argsPatch: {
        action: "find_files",
        pattern: "tsconfig",
        query: "tsconfig",
      },
      resultPatch: {
        success: undefined,
        results: undefined,
        total: undefined,
      },
    },
  ],
  glob: [
    {
      key: "completed",
      label: "Completed (4 files)",
      status: "completed",
      argsPatch: {
        action: "glob",
        pattern: "src/**/*.test.tsx",
        query: "src/**/*.test.tsx",
      },
      resultPatch: {
        success: true,
        total: 4,
        results: [
          {
            file: "src/hooks/__tests__/useAuth.test.tsx",
            line: 1,
            content: "src/hooks/__tests__/useAuth.test.tsx",
          },
          {
            file: "src/components/__tests__/Button.test.tsx",
            line: 1,
            content: "src/components/__tests__/Button.test.tsx",
          },
          {
            file: "src/engines/SessionCore/__tests__/registry.test.tsx",
            line: 1,
            content: "src/engines/SessionCore/__tests__/registry.test.tsx",
          },
          {
            file: "src/util/__tests__/formatToolName.test.tsx",
            line: 1,
            content: "src/util/__tests__/formatToolName.test.tsx",
          },
        ],
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      argsPatch: {
        action: "glob",
        pattern: "src/**/*.test.tsx",
        query: "src/**/*.test.tsx",
      },
      resultPatch: {
        success: undefined,
        results: undefined,
        total: undefined,
      },
    },
  ],
  symbols: [
    {
      key: "completed",
      label: "Completed (3 symbols)",
      status: "completed",
      argsPatch: {
        action: "symbols",
        pattern: "handleSubmit",
        query: "handleSubmit",
      },
      resultPatch: {
        success: true,
        total: 3,
        results: [
          {
            file: "src/components/LoginForm/index.tsx",
            line: 24,
            content: "function handleSubmit(event: FormEvent)",
          },
          {
            file: "src/modules/Settings/ProfileForm.tsx",
            line: 51,
            content: "const handleSubmit = useCallback(async () =>",
          },
          {
            file: "src/features/SessionCreator/CreateSession.tsx",
            line: 88,
            content: "async function handleSubmit(config: SessionConfig)",
          },
        ],
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      argsPatch: {
        action: "symbols",
        pattern: "handleSubmit",
        query: "handleSubmit",
      },
      resultPatch: {
        success: undefined,
        results: undefined,
        total: undefined,
      },
    },
  ],
  check_status: [
    {
      key: "completed",
      label: "Completed",
      status: "completed",
      argsPatch: {
        action: "check_status",
        pattern: undefined,
        query: undefined,
      },
      resultPatch: {
        success: true,
        total: 0,
        content:
          "Repository: /Users/dev/orgii_frontend\nSearch cache: ready\nLast updated: 2 minutes ago",
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      argsPatch: {
        action: "check_status",
        pattern: undefined,
        query: undefined,
      },
      resultPatch: { success: undefined },
    },
  ],
};
