import { z } from "zod";

export interface SettingDefinition<T extends z.ZodType = z.ZodType> {
  /** Zod schema for validation */
  schema: T;
  /** Default value */
  default: z.infer<T>;
  /** Human-readable description (used in JSONC comments and GUI) */
  description: string;
  /** Category for grouping in the GUI */
  category: SettingsCategory;
  /** Optional list of allowed values (for display in GUI dropdowns) */
  enumLabels?: Record<string, string>;
}

export type SettingsCategory =
  | "general"
  | "editor"
  | "terminal"
  | "notifications"
  | "chat"
  | "externalIde"
  | "git"
  | "agent"
  | "agentBrowser"
  | "network"
  | "mobileRemote";
