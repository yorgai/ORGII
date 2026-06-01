import { z } from "zod";

import type { SettingDefinition } from "@src/config/settingsSchema/types";

export const TERMINAL_SETTINGS_REGISTRY = {
  "terminal.shellType": {
    schema: z.enum(["repo", "default", "custom"]),
    default: "repo" as const,
    description:
      'Shell type: "repo" (use repo shell), "default" (system default), or "custom"',
    category: "terminal",
    enumLabels: {
      repo: "Repo Shell",
      default: "System Default",
      custom: "Custom",
    },
  },
  "terminal.customShellPath": {
    schema: z.string(),
    default: "/bin/zsh",
    description:
      'Custom shell executable path (when terminal.shellType is "custom")',
    category: "terminal",
  },
  "terminal.fontSize": {
    schema: z.number().int().min(8).max(32),
    default: 13,
    description: "Terminal font size in pixels (8-32)",
    category: "terminal",
  },
  "terminal.letterSpacing": {
    schema: z.number().min(-2).max(10),
    default: 0,
    description: "Terminal letter spacing in pixels (-2 to 10)",
    category: "terminal",
  },
} as const satisfies Record<string, SettingDefinition>;
