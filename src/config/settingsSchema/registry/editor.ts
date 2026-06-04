import { z } from "zod";

import type { SettingDefinition } from "@src/config/settingsSchema/types";

export const EDITOR_SETTINGS_REGISTRY = {
  "editor.fontFamily": {
    schema: z.enum([
      "System Default",
      "JetBrains Mono",
      "Fira Code",
      "Source Code Pro",
      "Cascadia Code",
      "IBM Plex Mono",
      "Ubuntu Mono",
      "Hack",
      "Inconsolata",
      "Custom",
    ]),
    default: "System Default" as const,
    description: "Code font family preset",
    category: "editor",
  },
  "editor.customFontFamily": {
    schema: z.string(),
    default: "",
    description: 'Custom font family name (when editor.fontFamily is "custom")',
    category: "editor",
  },
  "editor.fontSize": {
    schema: z.number().int().min(10).max(24),
    default: 13,
    description: "Editor font size in pixels (10-24)",
    category: "editor",
  },
  "editor.tabSize": {
    schema: z.union([z.literal(2), z.literal(4), z.literal(8)]),
    default: 2,
    description: "Tab size in spaces: 2, 4, or 8",
    category: "editor",
  },
  "editor.lineHeight": {
    schema: z.number().min(1.2).max(2.0),
    default: 1.5,
    description: "Line height multiplier (1.2-2.0)",
    category: "editor",
  },
  "editor.lineNumbers": {
    schema: z.enum(["on", "off", "relative", "interval"]),
    default: "on" as const,
    description:
      'Line number display mode: "on", "off", "relative", or "interval"',
    category: "editor",
    enumLabels: {
      on: "On",
      off: "Off",
      relative: "Relative",
      interval: "Interval (every 10)",
    },
  },
  "editor.wordWrap": {
    schema: z.boolean(),
    default: false,
    description: "Enable word wrap (soft wrap long lines)",
    category: "editor",
  },
  "editor.autoSave": {
    schema: z.boolean(),
    default: false,
    description: "Automatically save edited files after typing stops",
    category: "editor",
  },
  "editor.showMinimap": {
    schema: z.boolean(),
    default: false,
    description: "Show minimap (code overview panel on the right)",
    category: "editor",
  },
  "editor.showIndentGuides": {
    schema: z.boolean(),
    default: true,
    description: "Show indent guides (vertical lines for indentation levels)",
    category: "editor",
  },
  "editor.showTreeIndentGuides": {
    schema: z.boolean(),
    default: true,
    description:
      "Show vertical indent guide lines in file tree and other tree views",
    category: "editor",
  },
  "editor.highlightActiveLine": {
    schema: z.boolean(),
    default: true,
    description: "Highlight the active line in the editor",
    category: "editor",
  },
  "editor.showBlame": {
    schema: z.boolean(),
    default: false,
    description:
      "Show inline git blame annotation on the current cursor line (author, time, commit summary)",
    category: "editor",
  },
} as const satisfies Record<string, SettingDefinition>;
